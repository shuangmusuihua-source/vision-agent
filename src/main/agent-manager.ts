import { BrowserWindow } from 'electron'
import { createRequire } from 'module'
import { existsSync } from 'fs'
import { appendFile } from 'fs/promises'
import { join } from 'path'
import { query, listSessions, getSessionMessages, Query } from '@anthropic-ai/claude-agent-sdk'
import type { Options, SDKMessage, PermissionResult, HookCallback, HookCallbackMatcher } from '@anthropic-ai/claude-agent-sdk'
import { getAppSkillsCwd } from './skill-init'
import { SkillOutputBridge } from './skill-output-bridge'
import type { AgentIPCMessage, AskUserQuestionOption } from '../shared/types'
import { getApiKey, getBaseUrl, getModel, getAuthorizedDirectories, getActiveProfile } from './store'
import { notifyAgentComplete, schedulePermissionNotification, cancelPermissionNotification } from './notification-manager'

let _cachedCliPath: string | undefined | null = null

export function resolveClaudeCodeExecutable(): string | undefined {
  if (_cachedCliPath !== null) return _cachedCliPath

  const require = createRequire(import.meta.url)

  // 优先使用平台原生二进制
  try {
    const nativeBinary = require.resolve('@anthropic-ai/claude-agent-sdk-darwin-arm64/claude')
    if (existsSync(nativeBinary)) {
      _cachedCliPath = nativeBinary
      return nativeBinary
    }
  } catch {}

  // 回退到 cli.js
  try {
    const cliJs = require.resolve('@anthropic-ai/claude-agent-sdk/cli.js')
    if (existsSync(cliJs)) {
      _cachedCliPath = cliJs
      return cliJs
    }
  } catch {}

  _cachedCliPath = undefined
  return undefined
}

interface SessionInfo {
  id: string
  createdAt: number
  messageCount: number
}

const sessions = new Map<string, SessionInfo>()

const MAX_SESSIONS = 50
function evictOldSessions() {
  if (sessions.size <= MAX_SESSIONS) return
  const keys = [...sessions.keys()]
  const toDelete = keys.slice(0, sessions.size - MAX_SESSIONS)
  for (const key of toDelete) {
    sessions.delete(key)
  }
}

// Pending permission requests waiting for user response
const pendingPermissions = new Map<string, {
  resolve: (result: PermissionResult) => void
  input: Record<string, unknown>
}>()

// Pending AskUserQuestion requests waiting for user input
const pendingAskUser = new Map<string, {
  resolve: (result: PermissionResult) => void
  originalInput: Record<string, unknown>
  timeout: ReturnType<typeof setTimeout>
}>()

// Audit log path
const AUDIT_LOG_PATH = `${process.env.HOME || '/tmp'}/.vision-agent/audit.log`

async function writeAuditLog(entry: Record<string, unknown>): Promise<void> {
  try {
    const line = JSON.stringify({ timestamp: new Date().toISOString(), ...entry }) + '\n'
    await appendFile(AUDIT_LOG_PATH, line, { encoding: 'utf-8' })
  } catch {
    // Audit log write failure should not block agent
  }
}

function buildHooks(mainWindow: BrowserWindow): Partial<Record<string, HookCallbackMatcher[]>> {
  const auditPreToolUse: HookCallback = async (input, _toolUseID, _options) => {
    await writeAuditLog({
      event: 'PreToolUse',
      tool: (input as Record<string, unknown>).tool_name,
      input: JSON.stringify((input as Record<string, unknown>).tool_input).substring(0, 500)
    })
    return {}
  }

  const auditPostToolUse: HookCallback = async (input, _toolUseID, _options) => {
    await writeAuditLog({
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

export function resolvePermission(requestId: string, behavior: 'allow' | 'deny'): void {
  const pending = pendingPermissions.get(requestId)
  if (!pending) return
  pendingPermissions.delete(requestId)
  cancelPermissionNotification(requestId)
  if (behavior === 'allow') {
    pending.resolve({ behavior: 'allow', updatedInput: pending.input })
  } else {
    pending.resolve({ behavior: 'deny', message: 'User denied permission' })
  }
}

export function resolveAskUser(requestId: string, answer: string): void {
  const pending = pendingAskUser.get(requestId)
  if (!pending) {
    console.warn(`[AgentManager] resolveAskUser: ${requestId} not found in pending map`)
    return
  }
  pendingAskUser.delete(requestId)
  clearTimeout(pending.timeout)

  // Build answers map keyed by question text
  const questions = pending.originalInput.questions as Array<Record<string, unknown>> | undefined
  const firstQ = questions?.[0]
  const questionText = (firstQ?.question as string) || 'answer'
  const answers = { [questionText]: answer }

  try {
    pending.resolve({ behavior: 'allow', updatedInput: { ...pending.originalInput, answers } })
  } catch {
    // Subprocess may have already exited
  }
}

function buildOptions(mainWindow: BrowserWindow, activeFilePath?: string): Options {
  const apiKey = getApiKey()
  const model = getModel()
  const baseUrl = getBaseUrl()
  const profile = getActiveProfile()
  const dirs = getAuthorizedDirectories()
  const workspaceCwd = dirs.length > 0 ? dirs[0] : process.cwd()

  const env: Record<string, string | undefined> = { ...process.env }
  if (apiKey) {
    env.ANTHROPIC_API_KEY = apiKey
  }
  if (baseUrl) {
    env.ANTHROPIC_BASE_URL = baseUrl
  }

  const cliPath = resolveClaudeCodeExecutable()

  return {
    model,
    cwd: getAppSkillsCwd(),
    allowedTools: ['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch'],
    permissionMode: 'default',
    settingSources: ['project'],
    skills: 'all',
    includePartialMessages: true,
    env,
    ...(cliPath ? { pathToClaudeCodeExecutable: cliPath } : {}),
    systemPrompt: {
      type: 'preset' as const,
      preset: 'claude_code' as const,
      append: [
        '当你需要用户提供信息或做出选择时，请使用 AskUserQuestion 工具，将选项通过 options 参数提供，而不是在文本中列出建议。',
        activeFilePath ? `用户当前正在查看的文件: ${activeFilePath}\n如果需要了解文件内容，请使用 Read 工具读取该文件。` : '',
        workspaceCwd !== getAppSkillsCwd() ? `用户的工作区目录: ${workspaceCwd}\n读写用户文件时，请使用完整路径。` : ''
      ].filter(Boolean).join('\n')
    },
    settings: {
      autoMemoryDirectory: join(workspaceCwd, '.vision', 'memory')
    },
    hooks: buildHooks(mainWindow),
    canUseTool: async (
      toolName: string,
      input: Record<string, unknown>,
      options: { signal: AbortSignal; suggestions?: unknown[] }
    ): Promise<PermissionResult> => {
      // Auto-allow safe read-only tools
      if (toolName === 'WebSearch' || toolName === 'WebFetch' || toolName === 'Glob' || toolName === 'Grep') {
        return { behavior: 'allow', updatedInput: input }
      }

      // Auto-allow Read within authorized directories and app skills directory
      if (toolName === 'Read') {
        const pathToCheck = extractPathFromToolInput(toolName, input)
        if (pathToCheck) {
          const isAuthorized = dirs.some((dir) => pathToCheck.startsWith(dir))
          const isAppSkill = pathToCheck.startsWith(getAppSkillsCwd())
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
        })

        return new Promise<PermissionResult>((resolve) => {
          const timeout = setTimeout(() => {
            if (pendingAskUser.has(requestId)) {
              pendingAskUser.delete(requestId)
              mainWindow.webContents.send('agent:askUserTimeout', { requestId })
              resolve({ behavior: 'deny', message: 'AskUserQuestion timed out — user did not respond' })
            }
          }, 300000)

          pendingAskUser.set(requestId, { resolve, timeout, originalInput: input })
        })
      }

      // All other tools (Bash, Write, Edit) require user approval
      const requestId = `perm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      mainWindow.webContents.send('agent:permissionRequest', {
        id: requestId,
        toolName,
        input
      })
      schedulePermissionNotification(requestId, toolName)

      return new Promise<PermissionResult>((resolve) => {
        pendingPermissions.set(requestId, { resolve, input })

        // Timeout after 5 minutes — auto-deny
        setTimeout(() => {
          if (pendingPermissions.has(requestId)) {
            pendingPermissions.delete(requestId)
            cancelPermissionNotification(requestId)
            resolve({ behavior: 'deny', message: 'Permission request timed out' })
          }
        }, 300000)
      })
    }
  }
}

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

// Guard against concurrent sendMessage calls
let _activeQuery: Query | null = null
let _activeAbortController: AbortController | null = null
let _activeSkillId: string | null = null
const _skillOutputBridge = new SkillOutputBridge()

export function abortActiveQuery(): void {
  if (_activeQuery) {
    try { (_activeQuery as any).abort() } catch {}
    _activeQuery = null
    _activeAbortController = null
  }
  if (_activeAbortController) {
    _activeAbortController.abort()
    _activeAbortController = null
  }
}

export function setSkillOutputWindow(win: BrowserWindow): void {
  _skillOutputBridge.setWindow(win)
}

export function setActiveSkillId(skillId: string | null): void {
  _activeSkillId = skillId
}

export async function sendMessage(
  mainWindow: BrowserWindow,
  prompt: string,
  sessionId?: string,
  activeFilePath?: string
): Promise<void> {
  // Abort any still-running query before starting a new one
  if (_activeQuery) {
    try { (_activeQuery as any).abort() } catch {}
    _activeQuery = null
    _activeAbortController = null
  }

  _skillOutputBridge.reset()

  const options = buildOptions(mainWindow, activeFilePath)
  let currentSessionId = sessionId

  try {
    const messageStream = query({
      prompt,
      options: {
        ...options,
        ...(currentSessionId ? { resume: currentSessionId } : {})
      }
    })
    _activeQuery = messageStream as Query

    for await (const message of messageStream) {
      if (mainWindow.isDestroyed()) break

      // Feed raw SDK event to skill output bridge (before conversion)
      _skillOutputBridge.processRawEvent(message as Record<string, unknown>, _activeSkillId)

      // Convert and emit via unified agent:event channel
      const ipcMsg = toAgentIPCMessage(message)
      if (ipcMsg) {
        mainWindow.webContents.send('agent:event', ipcMsg)
      }

      // Session creation still gets its own lifecycle channel
      if (!currentSessionId && message.session_id) {
        currentSessionId = message.session_id
        sessions.set(currentSessionId, {
          id: currentSessionId,
          createdAt: Date.now(),
          messageCount: 0
        })
        mainWindow.webContents.send('agent:sessionCreated', currentSessionId)
        evictOldSessions()
      }
    }

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
      type: 'result',
      subtype: 'error',
      errors: [userMessage],
      usage: { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0 },
      total_cost_usd: 0,
      duration_ms: 0,
    } as AgentIPCMessage)
  } finally {
    _activeQuery = null
    _activeAbortController = null
  }
}

/**
 * Convert an SDK message into a typed AgentIPCMessage for the renderer.
 * Unknown/irrelevant message types return null and are silently dropped.
 */
function toAgentIPCMessage(message: SDKMessage): AgentIPCMessage | null {
  const msg = message as Record<string, unknown>
  const type = (msg.type as string) || ''
  const subtype = (msg.subtype as string) || ''

  switch (type) {
    case 'system': {
      if (subtype === 'init') {
        return {
          type: 'system',
          subtype: 'init',
          session_id: (msg.session_id as string) || '',
          model: (msg.model as string) || '',
          tools: (msg.tools as string[]) || [],
        }
      }
      if (subtype === 'status') {
        const status = msg.status as string | null
        return {
          type: 'system',
          subtype: 'status',
          status: status === 'compacting' || status === 'requesting' ? status : null,
        }
      }
      if (subtype === 'compact_boundary') {
        return { type: 'system', subtype: 'compact_boundary' }
      }
      if (subtype === 'permission_denied') {
        return {
          type: 'system',
          subtype: 'permission_denied',
          tool_use_id: (msg.tool_use_id as string) || '',
          message: (msg.message as string) || '',
        }
      }
      // Drop other system subtypes (notification, task_notification, tool_use_summary)
      return null
    }

    case 'assistant': {
      const apiMessage = msg.message as Record<string, unknown> | undefined
      const content = apiMessage?.content as Array<Record<string, unknown>> | undefined
      if (!content) return null
      return {
        type: 'assistant',
        uuid: (msg.uuid as string) || '',
        message: { content: content as any },
      }
    }

    case 'user': {
      const apiMessage = msg.message as Record<string, unknown> | undefined
      const content = apiMessage?.content as Array<Record<string, unknown>> | undefined
      if (!content) return null
      return {
        type: 'user',
        uuid: (msg.uuid as string) || '',
        message: { content: content as any },
      }
    }

    case 'result': {
      const usage = msg.usage as Record<string, unknown> | undefined
      if (subtype === 'success') {
        return {
          type: 'result',
          subtype: 'success',
          usage: {
            input_tokens: (usage?.input_tokens as number) || 0,
            output_tokens: (usage?.output_tokens as number) || 0,
            cache_read_tokens: (usage?.cache_read_input_tokens as number) || 0,
            cache_creation_tokens: (usage?.cache_creation_input_tokens as number) || 0,
          },
          total_cost_usd: (msg.total_cost_usd as number) || 0,
          duration_ms: (msg.duration_ms as number) || 0,
        }
      }
      // Error result variants
      const errors = (msg.errors as string[]) || []
      return {
        type: 'result',
        subtype: 'error',
        errors,
        usage: {
          input_tokens: (usage?.input_tokens as number) || 0,
          output_tokens: (usage?.output_tokens as number) || 0,
          cache_read_tokens: (usage?.cache_read_input_tokens as number) || 0,
          cache_creation_tokens: (usage?.cache_creation_input_tokens as number) || 0,
        },
        total_cost_usd: (msg.total_cost_usd as number) || 0,
        duration_ms: (msg.duration_ms as number) || 0,
      }
    }

    case 'stream_event': {
      const event = msg.event as Record<string, unknown> | undefined
      if (!event) return null
      const eventType = (event.type as string) || ''

      // Only forward content-related events to renderer
      if (eventType === 'content_block_start' || eventType === 'content_block_delta' || eventType === 'content_block_stop') {
        return {
          type: 'stream_event',
          uuid: (msg.uuid as string) || '',
          event: event as any,
        }
      }
      // message_start/delta/stop are structural — forward them too for completeness
      if (eventType === 'message_start' || eventType === 'message_delta' || eventType === 'message_stop') {
        return {
          type: 'stream_event',
          uuid: (msg.uuid as string) || '',
          event: event as any,
        }
      }
      return null
    }

    default:
      return null
  }
}

export function getSessionList(): SessionInfo[] {
  return Array.from(sessions.values())
}

export function getSessionInfo(id: string): SessionInfo | undefined {
  return sessions.get(id)
}

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

export async function listSkills(): Promise<Array<{ name: string; description: string; argumentHint: string; aliases?: string[] }>> {
  const dirs = getAuthorizedDirectories()
  const cwd = dirs.length > 0 ? dirs[0] : process.cwd()
  const apiKey = getApiKey()
  const baseUrl = getBaseUrl()
  const profile = getActiveProfile()
  const cliPath = resolveClaudeCodeExecutable()

  const env: Record<string, string> = {}
  if (apiKey) env.ANTHROPIC_API_KEY = apiKey
  if (baseUrl && profile?.apiProvider === 'custom') env.ANTHROPIC_BASE_URL = baseUrl

  try {
    const messageStream = query({
      prompt: '__skill_discovery_probe__',
      options: {
        model: getModel(),
        cwd,
        skills: 'all',
        env,
        ...(cliPath ? { pathToClaudeCodeExecutable: cliPath } : {}),
        settings: {
          autoMemoryDirectory: join(cwd, '.vision', 'memory')
        }
      }
    })

    const skills = await (messageStream as Query).supportedCommands()
    // Abort the probe query — we only needed the skill list
    try { (messageStream as any).abort() } catch {}
    return skills.map(s => ({
      name: s.name,
      description: s.description,
      argumentHint: s.argumentHint,
      aliases: s.aliases
    }))
  } catch (err) {
    console.error('[AgentManager] listSkills error:', err)
    return []
  }
}