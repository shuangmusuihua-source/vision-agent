import type { BrowserWindow } from 'electron'
import { query, Query } from '@anthropic-ai/claude-agent-sdk'
import type { PermissionMode, PermissionResult, HookCallback, HookCallbackMatcher, CanUseTool } from '@anthropic-ai/claude-agent-sdk'
import { ensureWorkspaceSkills, getAppSkillsCwd, getAppSkillsDir } from './skill-init'
import { DEFAULT_AGENT_APPROVAL_MODE } from '../shared/types'
import type { AgentApprovalMode, AgentContext, AgentSessionEnvelope, AskUserQuestionOption, AskUserQuestionItem, PermissionUpdate } from '../shared/types'
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
import { writeAuditLog } from './agent-audit'
import type {
  PreToolUseHookInput,
  PostToolUseHookInput,
  PostToolUseFailureHookInput,
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
  const auditPreToolUse: HookCallback = async (input, _toolUseID, _options) => {
    const { tool_name, tool_input } = input as PreToolUseHookInput
    writeAuditLog({
      event: 'PreToolUse',
      tool: tool_name,
      input: JSON.stringify(tool_input).substring(0, 500)
    })
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

  const auditPostToolUse: HookCallback = async (input, toolUseID, _options) => {
    const { tool_name, tool_response } = input as PostToolUseHookInput
    writeAuditLog({
      event: 'PostToolUse',
      tool: tool_name,
      result: JSON.stringify(tool_response).substring(0, 500)
    })
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

  const auditPostToolUseFailure: HookCallback = async (input, toolUseID, _options) => {
    const { tool_name, error } = input as PostToolUseFailureHookInput
    writeAuditLog({
      event: 'PostToolUseFailure',
      tool: tool_name,
      result: error.substring(0, 500),
    })
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
    PreToolUse: [{ hooks: [auditPreToolUse] }],
    PostToolUse: [{ hooks: [auditPostToolUse] }],
    PostToolUseFailure: [{ hooks: [auditPostToolUseFailure] }],
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
  sessionId?: string,
  envelope?: AgentSessionEnvelope,
  getSessionId?: () => string | undefined,
  authorizedAttachmentPaths: string[] = [],
  explicitExternalPaths: string[] = [],
  approvalMode: AgentApprovalMode = DEFAULT_AGENT_APPROVAL_MODE,
) {
  const dirs = getAuthorizedDirectories()
  const workspacePath = workspacePathOverride || (dirs.length > 0 ? dirs[0] : process.cwd())
  const workingDirectory = workingDirectoryOverride || workspacePath
  const skillsDirectory = getAppSkillsDir()
  const sessionEnvelope = envelope || createSessionEnvelope({
    context,
    sessionId: sessionId || context,
    workspacePath,
    sdkSessionId: sessionId,
  })
  const currentEnvelope = (): AgentSessionEnvelope => ({
    ...sessionEnvelope,
    sdkSessionId: getSessionId?.() || sessionEnvelope.sdkSessionId,
  })
  const decideFileAccess = (toolName: string, input: Record<string, unknown>) => decideSessionFileAccess({
    toolName,
    input,
    workingDirectory,
    skillsDirectory,
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

    `你可使用 \`\`\`json-render 代码块输出富交互 UI。支持的组件及属性：
- Card: { title: string, description?: string } — 卡片容器，可嵌套子组件
- Table: { columns: [{ key, label }], rows: [{ key: value }] } — 数据表格
- Metric: { label: string, value: string, trend?: "up"|"down"|"neutral" } — 指标卡片
- Chart: { type: "bar"|"line", data: [{ label, value }], height?: number, color?: string } — 柱状图/折线图
- List + ListItem: { title?: string } / { icon?: string, title: string, subtitle?: string, href?: string } — 列表
- Badge: { label: string, variant?: "default"|"success"|"warning"|"error"|"info"|"accent" } — 标签
- CodeCard: { language?: string, title?: string } — 代码块
- Button: { label: string, variant?: "primary"|"secondary" } — 按钮
- Alert: { severity: "info"|"warning"|"error"|"success", title: string, content: string } — 提醒卡片
JSON 格式：{ root: "id", elements: { "id": { type: "组件名", props: {...}, children?: ["子元素id"], text?: "文本" } } }。
适合场景：数据查询结果用 Table/Chart、文件列表用 List+ListItem、关键词用 Badge 标注。
仅在不影响主要回答质量时使用；Markdown 仍然是首选格式。`,
  ].filter(Boolean).join('\n')

  return buildAgentOptions({
    memoryMode: 'global',
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
    skills: getEnabledSkills(),
    systemPromptAppend,
    hooks: buildHooks(mainWindow, {
      envelope: sessionEnvelope,
      getSdkSessionId: getSessionId,
      decideFileAccess,
    }),
    resume: sessionId || undefined,
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

export async function setPermissionMode(queryKey: string | undefined, mode: PermissionMode): Promise<boolean> {
  return sessionRuntime.setPermissionMode(queryKey, mode)
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
  prompt: string,
  sessionId?: string,
  activeFilePath?: string,
  context: AgentContext = 'editor',
  skillId?: string | null,
  workspacePath?: string,
  clientSessionKey?: string,
  title?: string,
  approvalMode: AgentApprovalMode = DEFAULT_AGENT_APPROVAL_MODE,
): Promise<void> {
  const queryKey = clientSessionKey || sessionId || context
  // Same-session starts are ordered from identity validation through
  // registration. Starts for different sessions use independent leases.
  const startLease = await sessionRuntime.acquireSessionStart(queryKey)
  const existingRecord = getSessionRecordById(queryKey)
  let effectiveContext = context
  let effectiveWorkspacePath: string
  let effectiveSdkSessionId = sessionId

  if (existingRecord) {
    const storedWorkspaceValid = existingRecord.context === 'ask'
      ? isExactAuthorizedRoot(existingRecord.workspacePath, [getAppSkillsCwd()])
      : isAuthorizedSessionWorkspace(existingRecord.workspacePath)
    const workspaceMatches = !workspacePath
      || isExactAuthorizedRoot(workspacePath, [existingRecord.workspacePath])
    const sdkSessionMatches = existingRecord.sdkSessionId
      ? !sessionId || sessionId === existingRecord.sdkSessionId
      : !sessionId
    if (!storedWorkspaceValid || context !== existingRecord.context || !workspaceMatches || !sdkSessionMatches) {
      sessionRuntime.emitExecutionError(mainWindow, createSessionEnvelope({
        context: existingRecord.context,
        sessionId: queryKey,
        workspacePath: existingRecord.workspacePath,
        sdkSessionId: existingRecord.sdkSessionId,
      }), '会话归属信息不匹配，请重新选择会话。')
      startLease.release()
      return
    }
    effectiveContext = existingRecord.context
    effectiveWorkspacePath = existingRecord.workspacePath
    effectiveSdkSessionId = existingRecord.sdkSessionId || sessionId
  } else if (context === 'ask') {
    effectiveWorkspacePath = getAppSkillsCwd()
  } else {
    effectiveWorkspacePath = workspacePath || getAuthorizedDirectories()[0] || ''
    if (!effectiveWorkspacePath || !isAuthorizedSessionWorkspace(effectiveWorkspacePath)) {
      sessionRuntime.emitExecutionError(mainWindow, createSessionEnvelope({
        context,
        sessionId: queryKey,
        workspacePath: effectiveWorkspacePath,
        sdkSessionId: sessionId,
      }), '工作区未授权，请重新选择工作区。')
      startLease.release()
      return
    }
  }

  try {
    await abortActiveQueryAndWait(queryKey)
  } catch (error) {
    startLease.release()
    sessionRuntime.emitExecutionError(mainWindow, createSessionEnvelope({
      context: effectiveContext,
      sessionId: queryKey,
      workspacePath: effectiveWorkspacePath,
      sdkSessionId: effectiveSdkSessionId,
    }), toUserFacingQueryError(error))
    return
  }

  // The previous run may materialize its SDK transcript while responding to
  // abort. Resume that transcript instead of using the pre-abort snapshot.
  const latestRecord = getSessionRecordById(queryKey) || existingRecord
  effectiveSdkSessionId = latestRecord?.sdkSessionId || effectiveSdkSessionId

  let effectiveWorkingDirectory = effectiveWorkspacePath

  try {
    if (effectiveContext === 'editor') {
      effectiveWorkingDirectory = await ensureSessionWorkingDirectory(effectiveWorkspacePath, queryKey)
    } else {
      effectiveWorkingDirectory = await ensureAskSessionWorkingDirectory(effectiveWorkspacePath, queryKey)
    }

    updateSessionRecord(queryKey, {
      workspacePath: effectiveWorkspacePath,
      workingDirectory: effectiveWorkingDirectory,
      context: effectiveContext,
      status: latestRecord?.status || 'empty',
      createdAt: latestRecord?.createdAt || Date.now(),
      lastModified: Date.now(),
      messageCount: latestRecord?.messageCount || 0,
    })
  } catch (error) {
    startLease.release()
    sessionRuntime.emitExecutionError(mainWindow, createSessionEnvelope({
      context: effectiveContext,
      sessionId: queryKey,
      workspacePath: effectiveWorkspacePath,
      sdkSessionId: effectiveSdkSessionId,
    }), toUserFacingQueryError(error))
    return
  }

  let runtimeEnvelope = createSessionEnvelope({
    context: effectiveContext,
    sessionId: queryKey,
    workspacePath: effectiveWorkspacePath,
    sdkSessionId: effectiveSdkSessionId,
  })
  let currentSessionId = effectiveSdkSessionId
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
      const conversion = await convertAttachmentsToMarkdown(effectiveWorkingDirectory, queryKey, convertRequests)
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

    const getSessionId = () => currentSessionId
    const options = buildOptions(
      mainWindow,
      activeFilePath,
      effectiveContext,
      effectiveWorkspacePath,
      effectiveWorkingDirectory,
      effectiveSdkSessionId,
      runtimeEnvelope,
      getSessionId,
      attachmentPaths,
      explicitExternalPaths,
      approvalMode,
    )
    const appSessionKey = queryKey
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

      const sdkSessionId = message.session_id || currentSessionId || runtimeEnvelope.sdkSessionId || undefined
      const eventEnvelope = sessionRuntime.resolveEventEnvelope(queryKey, runtimeEnvelope, sdkSessionId)
      sessionRuntime.emitSdkMessage(mainWindow, queryKey, eventEnvelope, message)

      // Session creation still gets its own lifecycle channel — tagged with context
      if (!currentSessionId && message.session_id) {
        currentSessionId = message.session_id
        runtimeEnvelope = sessionRuntime.materializeSdkSession(queryKey, currentSessionId) || {
          ...runtimeEnvelope,
          sdkSessionId: currentSessionId,
        }
        persistMaterializedSession({
          appSessionId: appSessionKey,
          sdkSessionId: currentSessionId,
          workspacePath: effectiveWorkspacePath,
          workingDirectory: effectiveWorkingDirectory,
          context: effectiveContext,
          title,
        })
        sessionRuntime.emitSessionCreated(mainWindow, runtimeEnvelope)
      } else if (currentSessionId && message.session_id && message.session_id !== currentSessionId) {
        // SDK compacted the session — a new session file was created on disk
        // with a different session_id. Track it so session-store filters it
        // out (it should not appear as a separate user-facing session).
        recordCompactionSessionId(message.session_id as string)
      }
    }

    // Flush any remaining batched text deltas after the stream ends
    sessionRuntime.flushText(queryKey, mainWindow)

    // The SDK stream has completed — the result message was already
    // emitted inside the for-await loop via agent:event channel.
    // Send a session-level completion notification only.
    notifyAgentComplete(currentSessionId || '')
  } catch (error) {
    if (!mainWindow.isDestroyed()) {
      sessionRuntime.emitExecutionError(mainWindow, {
        ...runtimeEnvelope,
        sdkSessionId: currentSessionId || runtimeEnvelope.sdkSessionId,
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
            sdkSessionId: currentSessionId || runtimeEnvelope.sdkSessionId,
          })
        }
      } catch (error) {
        console.error('[SessionOutputMetadata] failed to record Skill provenance:', error)
      }
    }
    sessionRuntime.finalizeRun(mainWindow, queryKey, queryInstanceId)
  }
}
