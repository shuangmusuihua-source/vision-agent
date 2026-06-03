import { BrowserWindow, app } from 'electron'
import { createRequire } from 'module'
import { existsSync } from 'fs'
import { appendFile } from 'fs/promises'
import { join, resolve } from 'path'
import { query, listSessions, getSessionMessages, Query } from '@anthropic-ai/claude-agent-sdk'
import type { Options, PermissionResult, HookCallback, HookCallbackMatcher } from '@anthropic-ai/claude-agent-sdk'
import { getAppSkillsCwd } from './skill-init'
import { SkillOutputBridge } from './skill-output-bridge'
import { toAgentIPCMessage } from './message-converter'
import type { AgentIPCMessage, AgentContext, AskUserQuestionOption } from '../shared/types'
import { getApiKey, getBaseUrl, getModel, getAuthorizedDirectories, getActiveProfile } from './store'
import { notifyAgentComplete, schedulePermissionNotification, cancelPermissionNotification } from './notification-manager'

let _cachedCliPath: string | undefined | null = null

export function resolveClaudeCodeExecutable(): string | undefined {
  if (_cachedCliPath !== null) return _cachedCliPath

  const require = createRequire(import.meta.url)

  // 优先使用平台原生二进制
  try {
    const nativeBinary = require.resolve('@anthropic-ai/claude-agent-sdk-darwin-arm64/claude')
    const resolved = resolveAsarPath(nativeBinary)
    if (existsSync(resolved)) {
      _cachedCliPath = resolved
      return resolved
    }
  } catch {}

  // 回退到 cli.js
  try {
    const cliJs = require.resolve('@anthropic-ai/claude-agent-sdk/cli.js')
    const resolved = resolveAsarPath(cliJs)
    if (existsSync(resolved)) {
      _cachedCliPath = resolved
      return resolved
    }
  } catch {}

  _cachedCliPath = undefined
  return undefined
}

function resolveAsarPath(filePath: string): string {
  return filePath.replace('.asar/', '.asar.unpacked/').replace('.asar\\', '.asar.unpacked\\')
}

interface SessionInfo {
  id: string
  createdAt: number
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
  timeout: ReturnType<typeof setTimeout>
  context: AgentContext
}>()

// Pending AskUserQuestion requests waiting for user input
const pendingAskUser = new Map<string, {
  resolve: (result: PermissionResult) => void
  originalInput: Record<string, unknown>
  timeout: ReturnType<typeof setTimeout>
  context: AgentContext
}>()

// Audit log path
const AUDIT_LOG_PATH = join(app.getPath('userData'), 'audit.log')

const AUDIT_REDACT_PATTERNS = [
  /(?:api[_-]?key|apikey|secret|token|password|auth)\s*[:=]\s*['"]?[^\s'"]+['"]?/gi,
  /sk-[a-zA-Z0-9]{20,}/g,
  /(?:Bearer\s+)[a-zA-Z0-9._\-]+/g,
]

function redactCredentials(text: string): string {
  let result = text
  for (const pattern of AUDIT_REDACT_PATTERNS) {
    result = result.replace(pattern, (m) => m.slice(0, 4) + '***[REDACTED]')
  }
  return result
}

async function writeAuditLog(entry: Record<string, unknown>): Promise<void> {
  try {
    const line = JSON.stringify({ timestamp: new Date().toISOString(), ...entry }) + '\n'
    await appendFile(AUDIT_LOG_PATH, redactCredentials(line), { encoding: 'utf-8' })
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
  clearTimeout(pending.timeout)
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

function buildOptions(mainWindow: BrowserWindow, activeFilePath?: string, context: AgentContext = 'editor'): Options {
  const apiKey = getApiKey()
  const model = getModel()
  const baseUrl = getBaseUrl()
  const profile = getActiveProfile()
  const dirs = getAuthorizedDirectories()
  const workspaceCwd = dirs.length > 0 ? dirs[0] : process.cwd()

  // Prepend common user-level bin paths so tools like pip/brew/npm are findable
  const userBinPaths = [
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
    '/usr/local/bin',
    '/usr/local/sbin',
    `${process.env.HOME}/.local/bin`,
  ].join(':')

  // Only forward whitelisted env vars to SDK subprocess (not entire process.env)
  const env: Record<string, string | undefined> = {
    HOME: process.env.HOME,
    USER: process.env.USER,
    LANG: process.env.LANG,
    LC_ALL: process.env.LC_ALL,
    PATH: `${userBinPaths}:${process.env.PATH}`,
  }
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
        activeFilePath ? `用户当前正在查看的文件: ${activeFilePath.replace(/[\n\r]/g, '')}\n如果需要了解文件内容，请使用 Read 工具读取该文件。` : '',
        workspaceCwd !== getAppSkillsCwd() ? `用户的工作区目录: ${workspaceCwd.replace(/[\n\r]/g, '')}\n读写用户文件时，请使用完整路径。` : ''
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
            if (pendingAskUser.has(requestId)) {
              pendingAskUser.delete(requestId)
              mainWindow.webContents.send('agent:askUserTimeout', { requestId, context })
              resolve({ behavior: 'deny', message: 'AskUserQuestion timed out — user did not respond' })
            }
          }, 300000)

          pendingAskUser.set(requestId, { resolve, timeout, originalInput: input, context })
        })
      }

      // // All other tools (Bash, Write, Edit) require user approval
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
          if (pendingPermissions.has(requestId)) {
            pendingPermissions.delete(requestId)
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
          if (pendingPermissions.has(requestId)) {
            pendingPermissions.delete(requestId)
            cancelPermissionNotification(requestId)
            mainWindow.webContents.send('agent:permissionTimeout', { requestId, context })
            resolve({ behavior: 'deny', message: 'Permission request timed out' })
          }
        }, 300000)

        pendingPermissions.set(requestId, { resolve, input, timeout, context })
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

interface ActiveQuery {
  query: Query
  skillId: string | null
  abortController: AbortController
}

// Guard against concurrent sendMessage calls — per context slot
const activeQueries = new Map<AgentContext, ActiveQuery>()
const _skillOutputBridge = new SkillOutputBridge()

function rejectAllPendingPermissions(context?: AgentContext): void {
  for (const [id, p] of pendingPermissions) {
    if (context && p.context !== context) continue
    pendingPermissions.delete(id)
    clearTimeout(p.timeout)
    cancelPermissionNotification(id)
    p.resolve({ behavior: 'deny', message: 'Query aborted' })
  }
}

function rejectAllPendingAskUser(context?: AgentContext): void {
  for (const [id, p] of pendingAskUser) {
    if (context && p.context !== context) continue
    pendingAskUser.delete(id)
    clearTimeout(p.timeout)
    p.resolve({ behavior: 'deny', message: 'Query aborted' })
  }
}

/** Clean up all pending promises when the renderer window is destroyed */
export function handleWindowDestroy(): void {
  rejectAllPendingPermissions()
  rejectAllPendingAskUser()
}

export function abortActiveQuery(context?: AgentContext): void {
  if (context) {
    const entry = activeQueries.get(context)
    if (entry) {
      entry.abortController.abort()
      activeQueries.delete(context)
    }
    rejectAllPendingPermissions(context)
    rejectAllPendingAskUser(context)
  } else {
    // Abort all
    for (const [, entry] of activeQueries) {
      entry.abortController.abort()
    }
    activeQueries.clear()
    rejectAllPendingPermissions()
    rejectAllPendingAskUser()
  }
}

export function setSkillOutputWindow(win: BrowserWindow): void {
  _skillOutputBridge.setWindow(win)
}

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

  _skillOutputBridge.reset()

  _skillOutputBridge.setContext(context)
  const options = buildOptions(mainWindow, activeFilePath, context)
  let currentSessionId = sessionId

  try {
    const abortController = new AbortController()
    const messageStream = query({
      prompt,
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
      const skillId = activeQueries.get(context)?.skillId ?? null
      _skillOutputBridge.processRawEvent(message as Record<string, unknown>, skillId)

      // Convert and emit via unified agent:event channel — tagged with context
      const ipcMsg = toAgentIPCMessage(message)
      if (ipcMsg) {
        mainWindow.webContents.send('agent:event', { context, ...ipcMsg })
      }

      // Session creation still gets its own lifecycle channel — tagged with context
      if (!currentSessionId && message.session_id) {
        currentSessionId = message.session_id
        sessions.set(currentSessionId, {
          id: currentSessionId,
          createdAt: Date.now(),
        })
        mainWindow.webContents.send('agent:sessionCreated', { context, sessionId: currentSessionId })
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
      context,
      type: 'result',
      subtype: 'error',
      errors: [userMessage],
      usage: { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0 },
      total_cost_usd: 0,
      duration_ms: 0,
    } as AgentIPCMessage & { context: AgentContext })
  } finally {
    activeQueries.delete(context)
    rejectAllPendingPermissions(context)
    rejectAllPendingAskUser(context)
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

