import type { BrowserWindow } from 'electron'
import { query, Query } from '@anthropic-ai/claude-agent-sdk'
import type { PermissionMode, PermissionResult, HookCallback, HookCallbackMatcher, CanUseTool } from '@anthropic-ai/claude-agent-sdk'
import { ensureWorkspaceSkills, getAppSkillsCwd, getAppSkillsDir } from './skill-init'
import { DEFAULT_AGENT_APPROVAL_MODE } from '../shared/types'
import type {
  AgentApprovalMode,
  AgentContext,
  AgentQueryRequest,
  AgentSessionEnvelope,
  AskUserQuestionOption,
  AskUserQuestionItem,
  PermissionUpdate,
} from '../shared/types'
import {
  getApiKey,
} from './persistence/profile-store'
import {
  getAuthorizedDirectories,
  getSessionRecordById,
  updateSessionRecord,
} from './persistence/workspace-store'
import { getEnabledSkills } from './persistence/settings-store'
import { notifyAgentComplete } from './notification-manager'
import { buildAgentOptions } from './agent-options'
import { buildSumiContextPrompt, buildSumiIdentityPrompt } from './agent-identity'
import type {
  PreToolUseHookInput,
  PostToolUseHookInput,
  NotificationHookInput,
} from '@anthropic-ai/claude-agent-sdk'
import { sessionRuntime } from './session-runtime'
import { createSessionEnvelope } from './session-envelope'
import { persistMaterializedSession, recordCompactionSessionId } from './session-persistence-adapter'
import {
  appendAttachmentConversionSummary,
  claimPromptAttachments,
  convertAttachmentsToMarkdown,
  stripFileConvertMarker,
} from './attachment-conversion'
import { isSkillAvailableAtInitialization } from '../shared/skill-invocation'
import { isExactAuthorizedRoot } from './agent-path-utils'
import { isAuthorizedSessionWorkspace } from './path-validator'
import {
  ensureAskSessionWorkingDirectory,
  ensureSessionWorkingDirectory,
} from './session-files'
import { decideSessionFileAccess, extractExplicitAbsolutePaths } from './session-file-access'
import { isSessionFileMutationTool } from './session-file-catalog'
import {
  captureSessionOutputSnapshot,
  recordSessionOutputProvenance,
  type SessionOutputSnapshot,
} from './session-output-metadata'
import { getGlobalMemoryDirectory } from './memory-policy'
import { filterOfficeSkillByRuntimeReadiness } from './officecli-runtime'

// ─── Hooks ─────────────────────────────────────────────────────────────

type HookSessionContext = {
  envelope: AgentSessionEnvelope
  getSdkSessionId?: () => string | undefined
  decideFileAccess?: (
    toolName: string,
    input: Record<string, unknown>,
  ) => ReturnType<typeof decideSessionFileAccess>
}

function buildHooks(mainWindow: BrowserWindow, hookContext: HookSessionContext): Partial<Record<string, HookCallbackMatcher[]>> {
  const preToolUse: HookCallback = async (input, _toolUseID, _options) => {
    const { tool_name, tool_input } = input as PreToolUseHookInput
    const fileAccess = hookContext.decideFileAccess?.(
      tool_name,
      (tool_input || {}) as Record<string, unknown>,
    )
    if (fileAccess === 'deny') {
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: '该路径不属于当前会话，且用户未在本次消息中明确提供。',
        },
      }
    }
    return {}
  }

  const postToolUse: HookCallback = async (input, toolUseID, _options) => {
    const { tool_name } = input as PostToolUseHookInput
    if (toolUseID) {
      sessionRuntime.finishGenerationTool(hookContext.envelope.sessionId, toolUseID, 'completed')
    }
    if (
      hookContext.envelope.context === 'editor'
      && isSessionFileMutationTool(tool_name)
      && !mainWindow.isDestroyed()
    ) {
      mainWindow.webContents.send('agent:sessionFilesChanged', {
        ...hookContext.envelope,
        sdkSessionId: hookContext.getSdkSessionId?.() || hookContext.envelope.sdkSessionId,
      })
    }
    return {}
  }

  const postToolUseFailure: HookCallback = async (_input, toolUseID, _options) => {
    if (toolUseID) {
      sessionRuntime.finishGenerationTool(hookContext.envelope.sessionId, toolUseID, 'failed')
    }
    return {}
  }

  const notificationHook: HookCallback = async (input, _toolUseID, _options) => {
    const { message, title, notification_type } = input as NotificationHookInput
    sessionRuntime.emitNotification(mainWindow, {
      ...hookContext.envelope,
      sdkSessionId: hookContext.getSdkSessionId?.() || hookContext.envelope.sdkSessionId,
    }, {
      type: notification_type || 'info',
      message: message || '',
      title: title || '',
    })
    return {}
  }

  return {
    PreToolUse: [{ hooks: [preToolUse] }],
    PostToolUse: [{ hooks: [postToolUse] }],
    PostToolUseFailure: [{ hooks: [postToolUseFailure] }],
    Notification: [{ hooks: [notificationHook] }]
  }
}

// ─── Options builder ───────────────────────────────────────────────────

function buildOptions(
  mainWindow: BrowserWindow,
  activeFilePath?: string,
  context: AgentContext = 'editor',
  workspacePathOverride?: string,
  workingDirectoryOverride?: string,
  sdkSessionId?: string,
  envelope?: AgentSessionEnvelope,
  getSdkSessionId?: () => string | undefined,
  authorizedAttachmentPaths: string[] = [],
  explicitExternalPaths: string[] = [],
  approvalMode: AgentApprovalMode = DEFAULT_AGENT_APPROVAL_MODE,
  enabledSkills: string[] = getEnabledSkills(),
) {
  const dirs = getAuthorizedDirectories()
  const workspacePath = workspacePathOverride || (dirs.length > 0 ? dirs[0] : process.cwd())
  const workingDirectory = workingDirectoryOverride || workspacePath
  const skillsDirectory = getAppSkillsDir()
  const sessionEnvelope = envelope || createSessionEnvelope({
    context,
    sessionId: context,
    workspacePath,
    sdkSessionId,
  })
  const currentEnvelope = (): AgentSessionEnvelope => ({
    ...sessionEnvelope,
    sdkSessionId: getSdkSessionId?.() || sessionEnvelope.sdkSessionId,
  })
  const memoryMode = 'global' as const
  const decideFileAccess = (toolName: string, input: Record<string, unknown>) => decideSessionFileAccess({
    toolName,
    input,
    workingDirectory,
    skillsDirectory,
    authorizedMemoryDirectory: memoryMode === 'global' ? getGlobalMemoryDirectory() : null,
    authorizedExternalReadPaths: authorizedAttachmentPaths,
    explicitExternalPaths,
  })

  const workspaceContextLines = buildSumiContextPrompt(context, workspacePath, workingDirectory)

  const systemPromptAppend = [
    buildSumiIdentityPrompt(context),
    '当你需要用户提供信息或做出选择时，请使用 AskUserQuestion 工具，将选项通过 options 参数提供，而不是在文本中列出建议。',
    workspaceContextLines,
    context === 'ask'
      ? '可使用 agent-browser CLI 操控真实浏览器（基于 Chrome）。能力：打开网页、截图、点击、填表、提取内容。通过 Bash 调用；仅在任务确实需要时生成截图，并使用用户明确授权的位置。'
      : `可使用 agent-browser CLI 操控真实浏览器（基于 Chrome）。能力：打开网页、截图、点击、填表、提取内容。适用于 SPA 页面、需要登录的页面、需截图的场景。用法：agent-browser open <url>、agent-browser screenshot --screenshot-dir ${workingDirectory}、agent-browser snapshot -i 等。截图存到当前会话目录方便后续 Read。通过 Bash 调用。`,
    activeFilePath ? `用户已将以下文件关联到当前对话: ${activeFilePath.replace(/[\n\r]/g, '')}\n回答问题或执行 Skill 前，必须先使用 Read 工具读取该文件的完整内容，并以文件内容作为主要上下文。` : '',
    context === 'editor' ? `当前会话文件目录: ${workingDirectory.replace(/[\n\r]/g, '')}。` : '',
  ].filter(Boolean).join('\n')

  return buildAgentOptions({
    memoryMode,
    permissionMode: approvalMode === 'auto' ? 'auto' : 'default',
    // Bare allow-list entries bypass canUseTool in recent SDK versions. Keep
    // this empty so every tool request reaches the session authorization gate.
    allowedTools: [],
    includePartialMessages: true,
    settingSources: ['project'],
    managedSettings: {
      allowManagedHooksOnly: true,
      allowManagedPermissionRulesOnly: true,
    },
    workspaceCwd: workingDirectory,
    skills: enabledSkills,
    systemPromptAppend,
    hooks: buildHooks(mainWindow, {
      envelope: sessionEnvelope,
      getSdkSessionId,
      decideFileAccess,
    }),
    resume: sdkSessionId || undefined,
    canUseTool: async (
      toolName: string,
      input: Record<string, unknown>,
      options: Parameters<CanUseTool>[2]
    ): Promise<PermissionResult> => {
      // Respect SDK abort signal — clean up if already aborted
      if (options.signal?.aborted) {
        return { behavior: 'deny', message: 'Tool use cancelled by SDK' }
      }

      // Auto-allow network read-only tools.
      if (toolName === 'WebSearch' || toolName === 'WebFetch') {
        return { behavior: 'allow', updatedInput: input }
      }
      if (toolName === 'Skill') {
        return { behavior: 'allow', updatedInput: input }
      }

      const fileAccess = decideFileAccess(toolName, input)
      if (fileAccess === 'allow') {
        return { behavior: 'allow', updatedInput: input }
      }
      if (fileAccess === 'deny') {
        return {
          behavior: 'deny',
          message: '该路径不属于当前会话，且用户未在本次消息中明确提供。',
        }
      }

      // AskUserQuestion — route to askUser flow instead of permission dialog
      if (toolName === 'AskUserQuestion') {
        // SDK format: { questions: [{ question, header, options: [{ label, description }], multiSelect }] }
        const rawQuestions = input.questions as Array<Record<string, unknown>> | undefined
        const questionItems: AskUserQuestionItem[] = (rawQuestions || []).map((q) => {
          const rawOptions = q.options as Array<Record<string, string>> | undefined
          const opts: AskUserQuestionOption[] = rawOptions?.map((o) => ({
            label: o.label || '',
            description: o.description || '',
          })) || []
          return {
            question: (q.question as string) || '',
            header: (q.header as string) || '',
            options: opts,
            multiSelect: (q.multiSelect as boolean) || false,
          }
        })

        return sessionRuntime.requestAskUserAnswer(mainWindow, currentEnvelope(), {
          questions: questionItems,
        }, input)
      }

      // All other tools (Bash, Write, Edit) require user approval
      return sessionRuntime.requestPermissionApproval(mainWindow, currentEnvelope(), {
        toolName,
        input,
        // Forward SDK-provided display metadata for richer permission UI
        title: (options as Record<string, unknown>).title as string | undefined,
        displayName: (options as Record<string, unknown>).displayName as string | undefined,
        description: (options as Record<string, unknown>).description as string | undefined,
        suggestions: (options as Record<string, unknown>).suggestions as PermissionUpdate[] | undefined,
      }, options.signal)
    },
  })
}

// ─── Query management ──────────────────────────────────────────────────

export function abortActiveQuery(queryKey?: string): void {
  sessionRuntime.abort(queryKey)
}

export async function abortActiveQueryAndWait(queryKey: string): Promise<void> {
  await sessionRuntime.abortAndWait(queryKey)
}

export async function setPermissionMode(sessionId: string | undefined, mode: PermissionMode): Promise<boolean> {
  return sessionRuntime.setPermissionMode(sessionId, mode)
}

/** Clean up all pending promises when the renderer window is destroyed */
export function handleWindowDestroy(): void {
  sessionRuntime.handleWindowDestroy()
}

export function setGenerationWindow(win: BrowserWindow): void {
  sessionRuntime.setGenerationWindow(win)
}

// ─── Main query loop ───────────────────────────────────────────────────

function toUserFacingQueryError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (!getApiKey() && !process.env.ANTHROPIC_API_KEY) {
    return '未配置 API Key。请在设置中添加 Anthropic API Key 后重试。'
  }
  if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|fetch failed|net::/i.test(message)) {
    return '网络连接失败，请检查网络后重试。'
  }
  if (/401|authentication|invalid.api.key|invalid_api_key/i.test(message)) {
    return 'API Key 无效，请在设置中检查配置。'
  }
  if (/429|rate.limit|quota/i.test(message)) {
    return '请求频率过高，请稍后重试。'
  }
  if (/Agent run did not stop in time/i.test(message)) {
    return '上一个任务仍在结束中，请稍后重试。'
  }
  return message
}

export async function sendMessage(
  mainWindow: BrowserWindow,
  request: AgentQueryRequest,
): Promise<void> {
  const {
    prompt,
    appSessionId,
    activeFilePath,
    context,
    skillId,
    workspacePath,
    title,
    approvalMode = DEFAULT_AGENT_APPROVAL_MODE,
  } = request
  // Same-session starts are ordered from identity validation through
  // registration. Starts for different sessions use independent leases.
  const startLease = await sessionRuntime.acquireSessionStart(appSessionId)
  const existingRecord = getSessionRecordById(appSessionId)
  let effectiveContext = context
  let effectiveWorkspacePath: string
  let effectiveSdkSessionId = existingRecord?.sdkSessionId

  if (existingRecord) {
    const storedWorkspaceValid = existingRecord.context === 'ask'
      ? isExactAuthorizedRoot(existingRecord.workspacePath, [getAppSkillsCwd()])
      : isAuthorizedSessionWorkspace(existingRecord.workspacePath)
    const workspaceMatches = !workspacePath
      || isExactAuthorizedRoot(workspacePath, [existingRecord.workspacePath])
    if (!storedWorkspaceValid || context !== existingRecord.context || !workspaceMatches) {
      sessionRuntime.emitExecutionError(mainWindow, createSessionEnvelope({
        context: existingRecord.context,
        sessionId: appSessionId,
        workspacePath: existingRecord.workspacePath,
        sdkSessionId: existingRecord.sdkSessionId,
      }), '会话归属信息不匹配，请重新选择会话。')
      startLease.release()
      return
    }
    effectiveContext = existingRecord.context
    effectiveWorkspacePath = existingRecord.workspacePath
    effectiveSdkSessionId = existingRecord.sdkSessionId
  } else if (context === 'ask') {
    effectiveWorkspacePath = getAppSkillsCwd()
  } else {
    effectiveWorkspacePath = workspacePath || getAuthorizedDirectories()[0] || ''
    if (!effectiveWorkspacePath || !isAuthorizedSessionWorkspace(effectiveWorkspacePath)) {
      sessionRuntime.emitExecutionError(mainWindow, createSessionEnvelope({
        context,
        sessionId: appSessionId,
        workspacePath: effectiveWorkspacePath,
      }), '工作区未授权，请重新选择工作区。')
      startLease.release()
      return
    }
  }

  try {
    await abortActiveQueryAndWait(appSessionId)
  } catch (error) {
    startLease.release()
    sessionRuntime.emitExecutionError(mainWindow, createSessionEnvelope({
      context: effectiveContext,
      sessionId: appSessionId,
      workspacePath: effectiveWorkspacePath,
      sdkSessionId: effectiveSdkSessionId,
    }), toUserFacingQueryError(error))
    return
  }

  // The previous run may materialize its SDK transcript while responding to
  // abort. Resume that transcript instead of using the pre-abort snapshot.
  const latestRecord = getSessionRecordById(appSessionId) || existingRecord
  effectiveSdkSessionId = latestRecord?.sdkSessionId || effectiveSdkSessionId

  let effectiveWorkingDirectory = effectiveWorkspacePath

  try {
    if (effectiveContext === 'editor') {
      effectiveWorkingDirectory = await ensureSessionWorkingDirectory(effectiveWorkspacePath, appSessionId)
    } else {
      effectiveWorkingDirectory = await ensureAskSessionWorkingDirectory(effectiveWorkspacePath, appSessionId)
    }

    updateSessionRecord(appSessionId, {
      workspacePath: effectiveWorkspacePath,
      workingDirectory: effectiveWorkingDirectory,
      context: effectiveContext,
      status: latestRecord?.status || 'empty',
      createdAt: latestRecord?.createdAt || Date.now(),
      lastModified: Date.now(),
    })
  } catch (error) {
    startLease.release()
    sessionRuntime.emitExecutionError(mainWindow, createSessionEnvelope({
      context: effectiveContext,
      sessionId: appSessionId,
      workspacePath: effectiveWorkspacePath,
      sdkSessionId: effectiveSdkSessionId,
    }), toUserFacingQueryError(error))
    return
  }

  let runtimeEnvelope = createSessionEnvelope({
    context: effectiveContext,
    sessionId: appSessionId,
    workspacePath: effectiveWorkspacePath,
    sdkSessionId: effectiveSdkSessionId,
  })
  let currentSdkSessionId = effectiveSdkSessionId
  let queryInstanceId = 0
  let outputSnapshot: SessionOutputSnapshot = {}

  try {
    // ── File conversion (pptx/xlsx/docx/pdf → markdown) ──
    const { attachmentPaths, convertRequests } = claimPromptAttachments(prompt)
    const convertPaths = convertRequests.map((request) => request.sourcePath)
    let processedPrompt = stripFileConvertMarker(prompt)
    const explicitExternalPaths = [...new Set([
      ...(activeFilePath ? [activeFilePath] : []),
      ...convertPaths,
      ...extractExplicitAbsolutePaths(prompt),
    ])]
    if (convertPaths.length > 0) {
      const conversion = await convertAttachmentsToMarkdown(
        effectiveWorkingDirectory,
        appSessionId,
        convertRequests,
      )
      processedPrompt = appendAttachmentConversionSummary(processedPrompt, conversion)
    }

    try {
      const sessionSkillLinks = await ensureWorkspaceSkills(effectiveWorkingDirectory)
      if (skillId && sessionSkillLinks.conflicts.includes(skillId)) {
        throw new Error(`工作区中存在同名 Skill，无法确认实际来源: ${skillId}`)
      }
    } catch (error) {
      throw new Error(`Skill 初始化失败: ${(error as Error).message}`)
    }

    if (effectiveContext === 'editor' && skillId) {
      outputSnapshot = await captureSessionOutputSnapshot(effectiveWorkingDirectory)
    }

    const enabledSkills = await filterOfficeSkillByRuntimeReadiness(getEnabledSkills())
    if (skillId === 'office-documents' && !enabledSkills.includes(skillId)) {
      throw new Error('Office 文档运行组件需要安装或更新，请在 Skills 中重新启用“Office 文档”。')
    }

    const getSdkSessionId = () => currentSdkSessionId
    const options = buildOptions(
      mainWindow,
      activeFilePath,
      effectiveContext,
      effectiveWorkspacePath,
      effectiveWorkingDirectory,
      effectiveSdkSessionId,
      runtimeEnvelope,
      getSdkSessionId,
      attachmentPaths,
      explicitExternalPaths,
      approvalMode,
      enabledSkills,
    )
    const abortController = new AbortController()
    const messageStream = query({
      prompt: processedPrompt,
      options: {
        ...options,
        abortController,
      }
    })
    queryInstanceId = sessionRuntime.registerRun({
      query: messageStream as Query,
      skillId: skillId ?? null,
      abortController,
      envelope: runtimeEnvelope,
    })
    sessionRuntime.beginSession(runtimeEnvelope, skillId ?? null)
    startLease.release()

    for await (const message of messageStream) {
      if (mainWindow.isDestroyed()) break

      if (skillId && message.type === 'system' && message.subtype === 'init') {
        if (!isSkillAvailableAtInitialization(skillId, message.skills, message.slash_commands)) {
          throw new Error(`Skill 未被 Agent SDK 发现: ${skillId}`)
        }
      }

      const sdkSessionId = message.session_id || currentSdkSessionId || runtimeEnvelope.sdkSessionId || undefined
      const eventEnvelope = sessionRuntime.resolveEventEnvelope(appSessionId, runtimeEnvelope, sdkSessionId)
      sessionRuntime.emitSdkMessage(mainWindow, appSessionId, eventEnvelope, message)

      // Session creation still gets its own lifecycle channel — tagged with context
      if (!currentSdkSessionId && message.session_id) {
        currentSdkSessionId = message.session_id
        runtimeEnvelope = sessionRuntime.materializeSdkSession(appSessionId, currentSdkSessionId) || {
          ...runtimeEnvelope,
          sdkSessionId: currentSdkSessionId,
        }
        persistMaterializedSession({
          appSessionId,
          sdkSessionId: currentSdkSessionId,
          workspacePath: effectiveWorkspacePath,
          workingDirectory: effectiveWorkingDirectory,
          context: effectiveContext,
          title,
        })
        sessionRuntime.emitSessionCreated(mainWindow, runtimeEnvelope)
      } else if (currentSdkSessionId && message.session_id && message.session_id !== currentSdkSessionId) {
        // SDK compacted the session — a new session file was created on disk
        // with a different session_id. Track it so session-store filters it
        // out (it should not appear as a separate user-facing session).
        recordCompactionSessionId(message.session_id as string)
      }
    }

    // Flush any remaining batched text deltas after the stream ends
    sessionRuntime.flushText(appSessionId, mainWindow)

    // The SDK stream has completed — the result message was already
    // emitted inside the for-await loop via agent:event channel.
    // Send a session-level completion notification only.
    notifyAgentComplete()
  } catch (error) {
    if (!mainWindow.isDestroyed()) {
      sessionRuntime.emitExecutionError(mainWindow, {
        ...runtimeEnvelope,
        sdkSessionId: currentSdkSessionId || runtimeEnvelope.sdkSessionId,
      }, toUserFacingQueryError(error))
    }
  } finally {
    startLease.release()
    if (effectiveContext === 'editor' && skillId) {
      try {
        const changed = await recordSessionOutputProvenance({
          workingDirectory: effectiveWorkingDirectory,
          before: outputSnapshot,
          skillId,
          sourceDocumentPath: activeFilePath,
        })
        if (changed && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('agent:sessionFilesChanged', {
            ...runtimeEnvelope,
            sdkSessionId: currentSdkSessionId || runtimeEnvelope.sdkSessionId,
          })
        }
      } catch (error) {
        console.error('[SessionOutputMetadata] failed to record Skill provenance:', error)
      }
    }
    sessionRuntime.finalizeRun(mainWindow, appSessionId, queryInstanceId)
  }
}
