import { BrowserWindow } from 'electron'
import { createRequire } from 'module'
import { existsSync } from 'fs'
import { query } from '@anthropic-ai/claude-agent-sdk'
import type { Options, SDKMessage, PermissionResult } from '@anthropic-ai/claude-agent-sdk'
import { getApiKey, getBaseUrl, getModel, getAuthorizedDirectories, getActiveProfile } from './store'

function resolveClaudeCodeExecutable(): string | undefined {
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
}>()

export function resolvePermission(requestId: string, behavior: 'allow' | 'deny', alwaysAllow?: boolean): void {
  const pending = pendingPermissions.get(requestId)
  if (!pending) return
  pendingPermissions.delete(requestId)
  if (behavior === 'allow') {
    pending.resolve({ behavior: 'allow', updatedInput: undefined })
  } else {
    pending.resolve({ behavior: 'deny', message: 'User denied permission' })
  }
}

function buildOptions(mainWindow: BrowserWindow): Options {
  const apiKey = getApiKey()
  const model = getModel()
  const baseUrl = getBaseUrl()
  const profile = getActiveProfile()
  const dirs = getAuthorizedDirectories()
  const cwd = dirs.length > 0 ? dirs[0] : process.cwd()

  const env: Record<string, string> = {}
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
    permissionMode: 'dontAsk',
    env,
    ...(cliPath ? { pathToClaudeCodeExecutable: cliPath } : {}),
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

      // All other tools (Bash, Write, Edit) require user approval
      const requestId = `perm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      mainWindow.webContents.send('agent:permissionRequest', {
        id: requestId,
        toolName,
        input
      })

      return new Promise<PermissionResult>((resolve) => {
        pendingPermissions.set(requestId, { resolve })

        // Timeout after 5 minutes — auto-deny
        setTimeout(() => {
          if (pendingPermissions.has(requestId)) {
            pendingPermissions.delete(requestId)
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
  sessionId?: string
): Promise<void> {
  const options = buildOptions(mainWindow)
  let currentSessionId = sessionId

  console.log('[AgentManager] Sending message')
  console.log('[AgentManager] Model:', options.model, 'CWD:', options.cwd)
  console.log('[AgentManager] Has API key:', !!options.env?.ANTHROPIC_API_KEY)

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
      console.log('[AgentManager] Message received:', JSON.stringify(message).substring(0, 500))
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