import { BrowserWindow } from 'electron'
import { createRequire } from 'module'
import { existsSync } from 'fs'
import { appendFile } from 'fs/promises'
import { join } from 'path'
import { query, listSessions, getSessionMessages, Query } from '@anthropic-ai/claude-agent-sdk'
import type { Options, SDKMessage, PermissionResult, HookCallback, HookCallbackMatcher } from '@anthropic-ai/claude-agent-sdk'
import { getApiKey, getBaseUrl, getModel, getAuthorizedDirectories, getActiveProfile } from './store'
import { notifyAgentComplete, schedulePermissionNotification, cancelPermissionNotification } from './notification-manager'

export function resolveClaudeCodeExecutable(): string | undefined {
  const require = createRequire(import.meta.url)

  // 优先使用平台原生二进制
  try {
    const nativeBinary = require.resolve('@anthropic-ai/claude-agent-sdk-darwin-arm64/claude')
    if (existsSync(nativeBinary)) return nativeBinary
  } catch {}

  // 回退到 cli.js
  try {
    const cliJs = require.resolve('@anthropic-ai/claude-agent-sdk/cli.js')
    if (existsSync(cliJs)) return cliJs
  } catch {}

  return undefined
}

interface SessionInfo {
  id: string
  createdAt: number
  messageCount: number
}

const sessions = new Map<string, SessionInfo>()

// Pending permission requests waiting for user response
const pendingPermissions = new Map<string, {
  resolve: (result: PermissionResult) => void
  input: Record<string, unknown>
}>()

// Pending AskUserQuestion requests waiting for user input
const pendingAskUser = new Map<string, {
  resolve: (result: PermissionResult) => void
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
  if (!pending) return
  pendingAskUser.delete(requestId)
  clearTimeout(pending.timeout)
  // Pass the user's answer back as updatedInput so the agent receives it
  pending.resolve({ behavior: 'allow', updatedInput: { answer } })
}

function buildOptions(mainWindow: BrowserWindow, activeFilePath?: string): Options {
  const apiKey = getApiKey()
  const model = getModel()
  const baseUrl = getBaseUrl()
  const profile = getActiveProfile()
  const dirs = getAuthorizedDirectories()
  const cwd = dirs.length > 0 ? dirs[0] : process.cwd()

  const env: Record<string, string | undefined> = { ...process.env }
  if (apiKey) {
    env.ANTHROPIC_API_KEY = apiKey
  }
  if (baseUrl && profile?.apiProvider === 'custom') {
    env.ANTHROPIC_BASE_URL = baseUrl
  }

  const cliPath = resolveClaudeCodeExecutable()

  return {
    model,
    cwd,
    allowedTools: ['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch'],
    permissionMode: 'default',
    env,
    ...(cliPath ? { pathToClaudeCodeExecutable: cliPath } : {}),
    systemPrompt: {
      type: 'preset' as const,
      preset: 'claude_code' as const,
      ...(activeFilePath ? { append: `用户当前正在查看的文件: ${activeFilePath}\n如果需要了解文件内容，请使用 Read 工具读取该文件。` } : {})
    },
    settings: {
      autoMemoryDirectory: join(cwd, '.vision', 'memory')
    },
    skills: 'all',
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

      // Auto-allow Read within authorized directories
      if (toolName === 'Read') {
        const pathToCheck = extractPathFromToolInput(toolName, input)
        if (pathToCheck) {
          const isAuthorized = dirs.some((dir) => pathToCheck.startsWith(dir))
          if (isAuthorized) {
            return { behavior: 'allow', updatedInput: input }
          }
        }
      }

      // AskUserQuestion — route to askUser flow instead of permission dialog
      if (toolName === 'AskUserQuestion') {
        const requestId = `ask-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        const question = (input.question as string) || ''
        const rawOptions = input.options as Array<Record<string, string>> | undefined
        const optionsList = rawOptions?.map((o) => ({
          label: o.label || '',
          description: o.description || ''
        })) || undefined

        mainWindow.webContents.send('agent:askUser', {
          id: requestId,
          question,
          options: optionsList
        })

        return new Promise<PermissionResult>((resolve) => {
          const timeout = setTimeout(() => {
            if (pendingAskUser.has(requestId)) {
              pendingAskUser.delete(requestId)
              mainWindow.webContents.send('agent:askUserTimeout', { requestId })
              resolve({ behavior: 'deny', message: 'AskUserQuestion timed out — user did not respond' })
            }
          }, 300000)

          pendingAskUser.set(requestId, { resolve, timeout })
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

export async function sendMessage(
  mainWindow: BrowserWindow,
  prompt: string,
  sessionId?: string,
  activeFilePath?: string
): Promise<void> {
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

    let messageCount = 0

    for await (const message of messageStream) {
      if (!currentSessionId && message.session_id) {
        currentSessionId = message.session_id
        sessions.set(currentSessionId, {
          id: currentSessionId,
          createdAt: Date.now(),
          messageCount: 0
        })
        mainWindow.webContents.send('agent:sessionCreated', currentSessionId)
      }

      messageCount++
      mainWindow.webContents.send('agent:message', {
        sessionId: currentSessionId,
        message: serializeMessage(message)
      })
    }

    if (currentSessionId) {
      const session = sessions.get(currentSessionId)
      if (session) {
        session.messageCount = messageCount
      }
    }

    mainWindow.webContents.send('agent:complete', { sessionId: currentSessionId })
    notifyAgentComplete(currentSessionId)
  } catch (err) {
    mainWindow.webContents.send('agent:error', {
      sessionId: currentSessionId,
      error: (err as Error).message
    })
  }
}

function serializeMessage(message: SDKMessage): Record<string, unknown> {
  return JSON.parse(JSON.stringify(message))
}

export function getSessionList(): SessionInfo[] {
  return Array.from(sessions.values())
}

export function getSessionInfo(id: string): SessionInfo | undefined {
  return sessions.get(id)
}

export async function listSdkSessions(): Promise<Array<{ id: string; title?: string; createdAt?: number; lastModified?: number }>> {
  const dirs = getAuthorizedDirectories()
  const cwd = dirs.length > 0 ? dirs[0] : process.cwd()
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
    return messages.map((m) => JSON.parse(JSON.stringify(m)))
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
    try { (messageStream as Query).abort() } catch {}
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