import { BrowserWindow } from 'electron'
import { mkdirSync, writeFileSync } from 'fs'
import { join, resolve, basename } from 'path'
import { execFileSync } from 'child_process'
import { query, listSessions, getSessionMessages, Query } from '@anthropic-ai/claude-agent-sdk'
import type { PermissionResult, HookCallback, HookCallbackMatcher } from '@anthropic-ai/claude-agent-sdk'
import { getAppSkillsCwd } from './skill-init'
import { SkillOutputBridge } from './skill-output-bridge'
import { toAgentIPCMessage } from './message-converter'
import type { AgentIPCMessage, AgentContext, AskUserQuestionOption } from '../shared/types'
import { getApiKey, getAuthorizedDirectories, getEnabledSkills } from './store'
import { notifyAgentComplete, schedulePermissionNotification, cancelPermissionNotification } from './notification-manager'
import { buildAgentOptions } from './agent-options'
import { registerSession, getSessionList, getSessionInfo, type SessionInfo } from './agent-sessions'
import { writeAuditLog } from './agent-audit'
import {
  registerPendingPermission,
  registerPendingAskUser,
  hasPendingPermission,
  deletePendingPermission,
  hasPendingAskUser,
  deletePendingAskUser,
  resolvePermission,
  resolveAskUser,
  rejectAllPendingPermissions,
  rejectAllPendingAskUser,
} from './agent-permissions'
import { flushTextBatch, scheduleTextBatch, discardTextBatch, discardAllTextBatches, isTextDeltaEvent } from './agent-text-batch'

// ─── Re-exports (consumed by agent-handlers and index.ts) ──────────────

export { getSessionList, getSessionInfo, type SessionInfo }
export { registerSession }
export { resolvePermission, resolveAskUser }

// ─── Hooks ─────────────────────────────────────────────────────────────

function buildHooks(mainWindow: BrowserWindow): Partial<Record<string, HookCallbackMatcher[]>> {
  const auditPreToolUse: HookCallback = async (input, _toolUseID, _options) => {
    writeAuditLog({
      event: 'PreToolUse',
      tool: (input as Record<string, unknown>).tool_name,
      input: JSON.stringify((input as Record<string, unknown>).tool_input).substring(0, 500)
    })
    return {}
  }

  const auditPostToolUse: HookCallback = async (input, _toolUseID, _options) => {
    writeAuditLog({
      event: 'PostToolUse',
      tool: (input as Record<string, unknown>).tool_name,
      result: JSON.stringify((input as Record<string, unknown>).tool_result).substring(0, 500)
    })
    return {}
  }

  const notificationHook: HookCallback = async (input, _toolUseID, _options) => {
    const msg = (input as Record<string, unknown>).message as string || ''
    const title = (input as Record<string, unknown>).title as string || ''
    mainWindow.webContents.send('agent:notification', {
      type: (input as Record<string, unknown>).notification_type || 'info',
      message: msg,
      title
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

function buildOptions(mainWindow: BrowserWindow, activeFilePath?: string, context: AgentContext = 'editor') {
  const dirs = getAuthorizedDirectories()
  const workspaceCwd = dirs.length > 0 ? dirs[0] : process.cwd()

  const systemPromptAppend = [
    '当你需要用户提供信息或做出选择时，请使用 AskUserQuestion 工具，将选项通过 options 参数提供，而不是在文本中列出建议。',
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
    skills: getEnabledSkills(),
    systemPromptAppend,
    hooks: buildHooks(mainWindow),
    canUseTool: async (
      toolName: string,
      input: Record<string, unknown>,
      options: { signal: AbortSignal; suggestions?: unknown[] }
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
          const agentCwd = getAppSkillsCwd()
          const pathToCheck = resolve(agentCwd, rawPath)
          const isAuthorized = dirs.some((dir) => pathToCheck.startsWith(resolve(dir)))
          const isAppSkill = pathToCheck.startsWith(resolve(getAppSkillsCwd()))
          if (isAuthorized || isAppSkill) {
            return { behavior: 'allow', updatedInput: input }
          }
        }
      }

      // AskUserQuestion — route to askUser flow instead of permission dialog
      if (toolName === 'AskUserQuestion') {
        const requestId = `ask-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        // SDK format: { questions: [{ question, header, options: [{ label, description }], multiSelect }] }
        const questions = input.questions as Array<Record<string, unknown>> | undefined
        if (questions && questions.length > 1) {
          console.warn(`[AskUserQuestion] received ${questions.length} questions; only the first is supported.`)
        }
        const firstQ = questions?.[0]
        const question = (firstQ?.question as string) || ''
        const rawOptions = firstQ?.options as Array<Record<string, string>> | undefined
        const optionsList: AskUserQuestionOption[] = rawOptions?.map((o) => ({
          label: o.label || '',
          description: o.description || '',
        })) || []
        const multiSelect = (firstQ?.multiSelect as boolean) || false

        mainWindow.webContents.send('agent:askUser', {
          id: requestId,
          question,
          header: (firstQ?.header as string) || '',
          options: optionsList,
          multiSelect,
          context,
        })

        return new Promise<PermissionResult>((resolve) => {
          const timeout = setTimeout(() => {
            if (hasPendingAskUser(requestId)) {
              deletePendingAskUser(requestId)
              mainWindow.webContents.send('agent:askUserTimeout', { requestId, context })
              resolve({ behavior: 'deny', message: 'AskUserQuestion timed out — user did not respond' })
            }
          }, 300000)

          registerPendingAskUser(requestId, resolve, input, timeout, context)
        })
      }

      // All other tools (Bash, Write, Edit) require user approval
      const requestId = `perm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      mainWindow.webContents.send('agent:permissionRequest', {
        id: requestId,
        toolName,
        input,
        context,
      })
      schedulePermissionNotification(requestId, toolName)

      return new Promise<PermissionResult>((resolve) => {
        const cleanup = () => {
          if (hasPendingPermission(requestId)) {
            deletePendingPermission(requestId)
            cancelPermissionNotification(requestId)
            clearTimeout(timeout)
          }
        }

        // AbortSignal: SDK cancelled this tool use
        if (options.signal) {
          options.signal.addEventListener('abort', () => {
            cleanup()
            mainWindow.webContents.send('agent:permissionTimeout', { requestId, context })
            resolve({ behavior: 'deny', message: 'Tool use cancelled by SDK' })
          }, { once: true })
        }

        const timeout = setTimeout(() => {
          if (hasPendingPermission(requestId)) {
            deletePendingPermission(requestId)
            cancelPermissionNotification(requestId)
            mainWindow.webContents.send('agent:permissionTimeout', { requestId, context })
            resolve({ behavior: 'deny', message: 'Permission request timed out' })
          }
        }, 300000)

        registerPendingPermission(requestId, resolve, input, timeout, context)
      })
    },
  })
}

// ─── Query management ──────────────────────────────────────────────────

interface ActiveQuery {
  query: Query
  skillId: string | null
  abortController: AbortController
}

// Guard against concurrent sendMessage calls — per context slot
const activeQueries = new Map<AgentContext, ActiveQuery>()
const _skillOutputBridge = new SkillOutputBridge()

export function abortActiveQuery(context?: AgentContext): void {
  if (context) {
    const entry = activeQueries.get(context)
    if (entry) {
      entry.abortController.abort()
      activeQueries.delete(context)
    }
    rejectAllPendingPermissions(context)
    rejectAllPendingAskUser(context)
    discardTextBatch(context)
  } else {
    // Abort all
    for (const [, entry] of activeQueries) {
      entry.abortController.abort()
    }
    activeQueries.clear()
    rejectAllPendingPermissions()
    rejectAllPendingAskUser()
    for (const ctx of ['editor', 'ask'] as AgentContext[]) discardTextBatch(ctx)
  }
}

/** Clean up all pending promises when the renderer window is destroyed */
export function handleWindowDestroy(): void {
  rejectAllPendingPermissions()
  rejectAllPendingAskUser()
  discardAllTextBatches()
}

export function setSkillOutputWindow(win: BrowserWindow): void {
  _skillOutputBridge.setWindow(win)
}

// ─── Main query loop ───────────────────────────────────────────────────

export async function sendMessage(
  mainWindow: BrowserWindow,
  prompt: string,
  sessionId?: string,
  activeFilePath?: string,
  context: AgentContext = 'editor',
  skillId?: string | null
): Promise<void> {
  // Abort any active query in the same context slot
  const existing = activeQueries.get(context)
  if (existing) {
    abortActiveQuery(context)
  }

  // ── File conversion (pptx/xlsx/docx/pdf → markdown) ──
  let processedPrompt = prompt
  const convMatch = prompt.match(/<!--FILE_CONVERT:(.+?)-->/)
  if (convMatch) {
    const paths = convMatch[1].split('|').filter(Boolean)
    const dirs = getAuthorizedDirectories()
    const workspaceDir = dirs.length > 0 ? dirs[0] : process.cwd()
    const tmpDir = join(workspaceDir, '.vision', 'tmp')
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

  _skillOutputBridge.reset()
  _skillOutputBridge.setContext(context)
  const options = buildOptions(mainWindow, activeFilePath, context)
  let currentSessionId = sessionId

  try {
    const abortController = new AbortController()
    const messageStream = query({
      prompt: processedPrompt,
      options: {
        ...options,
        abortController,
        ...(currentSessionId ? { resume: currentSessionId } : {})
      }
    })
    activeQueries.set(context, { query: messageStream as Query, skillId: skillId ?? null, abortController })

    for await (const message of messageStream) {
      if (mainWindow.isDestroyed()) break

      // Feed raw SDK event to skill output bridge (before conversion)
      const activeSkillId = activeQueries.get(context)?.skillId ?? null
      _skillOutputBridge.processRawEvent(message as Record<string, unknown>, activeSkillId)

      const rawMsg = message as Record<string, unknown>
      const textDeltaText = isTextDeltaEvent(rawMsg)
      const ipcMsg = toAgentIPCMessage(message)

      if (textDeltaText !== null) {
        // Batch text_delta events: accumulate and flush every ~30ms
        const uuid = (rawMsg.uuid as string) || ''
        scheduleTextBatch(context, textDeltaText, uuid, mainWindow)
      } else {
        // Non-text event (tool_use, content_block_start/stop, result, etc.)
        // Flush any pending text batch FIRST to preserve event ordering
        flushTextBatch(context, mainWindow)

        if (ipcMsg) {
          mainWindow.webContents.send('agent:event', { context, ...ipcMsg })
        }
      }

      // Session creation still gets its own lifecycle channel — tagged with context
      if (!currentSessionId && message.session_id) {
        currentSessionId = message.session_id
        registerSession(currentSessionId)
        mainWindow.webContents.send('agent:sessionCreated', { context, sessionId: currentSessionId })
      }
    }

    // Flush any remaining batched text deltas after the stream ends
    flushTextBatch(context, mainWindow)

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
    mainWindow.webContents.send('agent:event', {
      context,
      type: 'result',
      subtype: 'error',
      errors: [userMessage],
      usage: { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0 },
      total_cost_usd: 0,
      duration_ms: 0,
    } as AgentIPCMessage & { context: AgentContext })
  } finally {
    // Flush any remaining batched text (if stream errored before for-await finished)
    flushTextBatch(context, mainWindow)
    discardTextBatch(context)
    activeQueries.delete(context)
    rejectAllPendingPermissions(context)
    rejectAllPendingAskUser(context)
  }
}

// ─── SDK session listing ───────────────────────────────────────────────

export async function listSdkSessions(): Promise<Array<{ id: string; title?: string; createdAt?: number; lastModified?: number }>> {
  const cwd = getAppSkillsCwd()
  try {
    const result = await listSessions({ dir: cwd })
    return result.map((s) => ({
      id: s.sessionId,
      title: s.customTitle || s.summary || s.firstPrompt,
      createdAt: s.createdAt,
      lastModified: s.lastModified
    }))
  } catch (err) {
    console.error('[AgentManager] listSessions error:', err)
    return []
  }
}

export async function loadSdkSessionMessages(sessionId: string): Promise<Array<Record<string, unknown>>> {
  try {
    const messages = await getSessionMessages(sessionId)
    return messages.map((m) => m as unknown as Record<string, unknown>)
  } catch (err) {
    console.error('[AgentManager] getSessionMessages error:', err)
    return []
  }
}
