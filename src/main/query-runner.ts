import type { BrowserWindow } from 'electron'
import { mkdirSync, writeFileSync } from 'fs'
import { join, resolve, basename } from 'path'
import { execFileSync } from 'child_process'
import { query, Query } from '@anthropic-ai/claude-agent-sdk'
import type { PermissionResult, HookCallback, HookCallbackMatcher, CanUseTool } from '@anthropic-ai/claude-agent-sdk'
import { getAppSkillsCwd, ensureWorkspaceSkills } from './skill-init'
import type { AgentContext, AgentSessionEnvelope, AskUserQuestionOption, AskUserQuestionItem, PermissionUpdate } from '../shared/types'
import { getApiKey, getAuthorizedDirectories, getEnabledSkills, recordSessionArtifactFromTool } from './store'
import { notifyAgentComplete } from './notification-manager'
import { buildAgentOptions } from './agent-options'
import { writeAuditLog } from './agent-audit'
import { isPathAuthorized } from './agent-path-utils'
import type { PreToolUseHookInput, PostToolUseHookInput, NotificationHookInput } from '@anthropic-ai/claude-agent-sdk'
import { createSessionEnvelope, sessionRuntime } from './session-runtime'
import { persistMaterializedSession, recordCompactionSessionId } from './session-persistence-adapter'

// ─── Hooks ─────────────────────────────────────────────────────────────

type HookSessionContext = {
  envelope: AgentSessionEnvelope
  getSdkSessionId?: () => string | undefined
  skillId?: string | null
}

function buildHooks(mainWindow: BrowserWindow, hookContext: HookSessionContext): Partial<Record<string, HookCallbackMatcher[]>> {
  const auditPreToolUse: HookCallback = async (input, _toolUseID, _options) => {
    const { tool_name, tool_input } = input as PreToolUseHookInput
    writeAuditLog({
      event: 'PreToolUse',
      tool: tool_name,
      input: JSON.stringify(tool_input).substring(0, 500)
    })
    return {}
  }

  const auditPostToolUse: HookCallback = async (input, _toolUseID, _options) => {
    const { tool_name, tool_input, tool_response } = input as PostToolUseHookInput
    writeAuditLog({
      event: 'PostToolUse',
      tool: tool_name,
      result: JSON.stringify(tool_response).substring(0, 500)
    })
    recordSessionArtifactFromTool({
      sessionId: hookContext.envelope.sessionId,
      sdkSessionId: hookContext.getSdkSessionId?.() || hookContext.envelope.sdkSessionId,
      workspacePath: hookContext.envelope.workspacePath,
      toolName: tool_name,
      toolInput: tool_input,
      skillId: hookContext.skillId,
    })
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
    Notification: [{ hooks: [notificationHook] }]
  }
}

// ─── Options builder ───────────────────────────────────────────────────

function extractPathFromToolInput(
  toolName: string,
  input: Record<string, unknown>
): string | null {
  const pathFields: Record<string, string[]> = {
    Read: ['file_path'],
    Edit: ['file_path'],
    Write: ['file_path'],
    Glob: ['path'],
    Grep: ['path'],
    Bash: ['command']
  }

  const fields = pathFields[toolName]
  if (!fields) return null

  const value = String(input[fields[0]] ?? '')
  if (!value) return null

  if (toolName === 'Bash') {
    const pathMatch = value.match(/(?:\/[\w.-]+)+/)
    return pathMatch ? pathMatch[0] : null
  }

  return value
}

function buildOptions(mainWindow: BrowserWindow, activeFilePath?: string, context: AgentContext = 'editor', workspaceCwdOverride?: string, sessionId?: string, envelope?: AgentSessionEnvelope, getSessionId?: () => string | undefined, skillId?: string | null) {
  const dirs = getAuthorizedDirectories()
  const workspaceCwd = workspaceCwdOverride || (dirs.length > 0 ? dirs[0] : process.cwd())
  const sessionEnvelope = envelope || createSessionEnvelope({
    context,
    sessionId: sessionId || context,
    workspacePath: workspaceCwd,
    sdkSessionId: sessionId,
  })
  const currentEnvelope = (): AgentSessionEnvelope => ({
    ...sessionEnvelope,
    sdkSessionId: getSessionId?.() || sessionEnvelope.sdkSessionId,
  })

  // Build workspace context for the agent
  const workspaceName = workspaceCwd.split('/').pop() || workspaceCwd
  const workspaceContextLines = [
    `## 当前工作区`,
    `- 工作区名称: ${workspaceName}`,
    `- 工作区路径: ${workspaceCwd}`,
    `- 该工作区是用户的独立工作环境，所有文件读写应在该目录下进行`,
    `- 会话结束后，关键结论应记录为 markdown 文件保存到该工作区`,
  ].join('\n')

  const systemPromptAppend = [
    '当你需要用户提供信息或做出选择时，请使用 AskUserQuestion 工具，将选项通过 options 参数提供，而不是在文本中列出建议。',
    workspaceContextLines,
    `可使用 agent-browser CLI 操控真实浏览器（基于 Chrome）。能力：打开网页、截图、点击、填表、提取内容。适用于 SPA 页面、需要登录的页面、需截图的场景。用法：agent-browser open <url>、agent-browser screenshot --screenshot-dir ${workspaceCwd}、agent-browser snapshot -i 等。截图存到工作区目录方便后续 Read。通过 Bash 调用。`,
    activeFilePath ? `用户当前正在查看的文件: ${activeFilePath.replace(/[\n\r]/g, '')}\n如果需要了解文件内容，请使用 Read 工具读取该文件。` : '',
    workspaceCwd !== getAppSkillsCwd() ? `用户的工作区目录: ${workspaceCwd.replace(/[\n\r]/g, '')}\n读写用户文件时，请使用完整路径。` : '',

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
    permissionMode: 'default',
    allowedTools: ['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch'],
    includePartialMessages: true,
    settingSources: ['project'],
    workspaceCwd,
    skills: getEnabledSkills(),
    systemPromptAppend,
    hooks: buildHooks(mainWindow, {
      envelope: sessionEnvelope,
      getSdkSessionId: getSessionId,
      skillId,
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

      // Auto-allow safe read-only tools
      if (toolName === 'WebSearch' || toolName === 'WebFetch' || toolName === 'Glob' || toolName === 'Grep') {
        return { behavior: 'allow', updatedInput: input }
      }

      // Auto-allow Read within authorized directories and app skills directory
      if (toolName === 'Read') {
        const rawPath = extractPathFromToolInput(toolName, input)
        if (rawPath) {
          const pathToCheck = resolve(workspaceCwd, rawPath)
          const isAuth = isPathAuthorized(pathToCheck, dirs)
          const isAppSkill = pathToCheck.startsWith(resolve(getAppSkillsCwd()))
          if (isAuth || isAppSkill) {
            return { behavior: 'allow', updatedInput: input }
          }
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

        const firstQ = questionItems[0]
        return sessionRuntime.requestAskUserAnswer(mainWindow, currentEnvelope(), {
          questions: questionItems,
          question: firstQ?.question || '',
          header: firstQ?.header || '',
          options: firstQ?.options || [],
          multiSelect: firstQ?.multiSelect || false,
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

/** Clean up all pending promises when the renderer window is destroyed */
export function handleWindowDestroy(): void {
  sessionRuntime.handleWindowDestroy()
}

export function setSkillOutputWindow(win: BrowserWindow): void {
  sessionRuntime.setSkillOutputWindow(win)
}

// ─── Main query loop ───────────────────────────────────────────────────

export async function sendMessage(
  mainWindow: BrowserWindow,
  prompt: string,
  sessionId?: string,
  activeFilePath?: string,
  context: AgentContext = 'editor',
  skillId?: string | null,
  workspacePath?: string,
  clientSessionKey?: string,
  title?: string
): Promise<void> {
  // Abort any previous query for the same app-owned session key.
  // Different sessions in the same context can now run in parallel.
  const queryKey = clientSessionKey || sessionId || context
  abortActiveQuery(queryKey)
  const effectiveWorkspaceCwd = workspacePath
    || (context === 'ask' ? getAppSkillsCwd() : undefined)
    || (getAuthorizedDirectories().length > 0 ? getAuthorizedDirectories()[0] : process.cwd())
  let runtimeEnvelope = createSessionEnvelope({
    context,
    sessionId: queryKey,
    workspacePath: effectiveWorkspaceCwd,
    sdkSessionId: sessionId,
  })

  // ── File conversion (pptx/xlsx/docx/pdf → markdown) ──
  let processedPrompt = prompt
  const convMatch = prompt.match(/<!--FILE_CONVERT:(.+?)-->/)
  if (convMatch) {
    const paths = convMatch[1].split('|').filter(Boolean)
    const tmpDir = join(effectiveWorkspaceCwd, '.vision', 'tmp')
    mkdirSync(tmpDir, { recursive: true })
    const refs: string[] = []

    for (const filePath of paths) {
      try {
        const outName = basename(filePath).replace(/\.[^.]+$/, '.md')
        const outPath = join(tmpDir, outName)
        const result = execFileSync('python3', ['-m', 'markitdown', filePath], {
          encoding: 'utf-8',
          timeout: 30000,
        })
        writeFileSync(outPath, result, 'utf-8')
        refs.push(`${outName} (已从 ${basename(filePath)} 转换)`)
      } catch (err) {
        console.error(`[FileConvert] ${filePath}:`, (err as Error).message)
      }
    }

    processedPrompt = prompt.replace(/<!--FILE_CONVERT:.+?-->\n?/, '').trim()
    if (refs.length > 0) {
      processedPrompt += '\n\n---\n已转换文件：\n' + refs.map(r => `- ${r}`).join('\n')
    }
  }

  sessionRuntime.beginSession(runtimeEnvelope)
  // Ensure workspace-local skills exist (idempotent via sentinel file).
  // Run async to avoid blocking the main thread on file I/O.
  // The sentinel check makes subsequent calls nearly instant (~0.1ms),
  // so the synchronous call is safe after the first run.
  ensureWorkspaceSkills(effectiveWorkspaceCwd)
  let currentSessionId = sessionId
  const getSessionId = () => currentSessionId
  const options = buildOptions(mainWindow, activeFilePath, context, effectiveWorkspaceCwd, sessionId, runtimeEnvelope, getSessionId, skillId)
  const appSessionKey = queryKey

  let queryInstanceId = 0
  try {
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

    for await (const message of messageStream) {
      if (mainWindow.isDestroyed()) break

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
          workspacePath: effectiveWorkspaceCwd,
          context,
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
  } catch (err) {
    const errMsg = (err as Error).message || String(err)
    let userMessage = errMsg
    if (!getApiKey() && !process.env.ANTHROPIC_API_KEY) {
      userMessage = '未配置 API Key。请在设置中添加 Anthropic API Key 后重试。'
    } else if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|fetch failed|net::/i.test(errMsg)) {
      userMessage = '网络连接失败，请检查网络后重试。'
    } else if (/401|authentication|invalid.api.key|invalid_api_key/i.test(errMsg)) {
      userMessage = 'API Key 无效，请在设置中检查配置。'
    } else if (/429|rate.limit|quota/i.test(errMsg)) {
      userMessage = '请求频率过高，请稍后重试。'
    }
    if (!mainWindow.isDestroyed()) {
      sessionRuntime.emitExecutionError(mainWindow, {
        ...runtimeEnvelope,
        sdkSessionId: currentSessionId || runtimeEnvelope.sdkSessionId,
      }, userMessage)
    }
  } finally {
    sessionRuntime.finalizeRun(mainWindow, queryKey, queryInstanceId)
  }
}
