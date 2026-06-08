// IPC channel type mapping — single source of truth for
// request/response shapes and event payloads across Main/Preload/Renderer.

import type {
  AgentIPCMessage,
  AskUserRequestIPC,
  PermissionRequestIPC,
  SdkSessionInfo,
  UsageInfo,
  GraphData,
} from './types'

// ─── Request/Response Channels ───────────────────────────────────────

export type IPCChannelMap = {
  // Agent
  'agent:sendMessage': {
    request: {
      prompt: string
      sessionId?: string
      activeFilePath?: string
      skillId?: string
      context?: 'editor' | 'ask'
    }
    response: { started: boolean }
  }
  'agent:abort': {
    request: 'editor' | 'ask' | undefined
    response: void
  }
  'agent:selectFolder': {
    request: void
    response: { canceled: boolean; filePaths: string[] }
  }
  'agent:permissionResponse': {
    request: {
      requestId: string
      behavior: 'allow' | 'deny'
    }
    response: { success: boolean }
  }
  'agent:respondAskUser': {
    request: {
      requestId: string
      answer: string
    }
    response: { success: boolean }
  }
  'agent:listSdkSessions': {
    request: void
    response: SdkSessionInfo[]
  }
  'agent:loadSessionMessages': {
    request: { sessionId: string }
    response: Array<Record<string, unknown>>
  }

  // Workspace
  'workspace:listFiles': {
    request: string
    response: unknown
  }
  'workspace:readFile': {
    request: string
    response: { success: boolean; content?: string; error?: string }
  }
  'workspace:writeFile': {
    request: [string, string]
    response: { success: boolean; error?: string }
  }
  'workspace:listMarkdownFiles': {
    request: string
    response: Array<{ label: string; path: string }>
  }
  'workspace:openDirectoryDialog': {
    request: void
    response: string | null
  }
  'workspace:newDirectoryDialog': {
    request: void
    response: string | null
  }
  'workspace:createWorkspace': {
    request: string
    response: string | null
  }
  'workspace:createFile': {
    request: [string, string]
    response: { success: boolean; path?: string; error?: string }
  }
  'workspace:openInBrowser': {
    request: string
    response: void
  }
  'workspace:previewArtifact': {
    request: { fileName: string; content: string }
    response: { success: boolean; filePath?: string }
  }
  'workspace:saveArtifact': {
    request: { fileName: string; content: string; defaultPath?: string }
    response: { success: boolean; filePath?: string }
  }

  // Settings
  'settings:get': {
    request: void
    response: Record<string, unknown>
  }
  'settings:addProfile': {
    request: Record<string, unknown>
    response: { success: boolean }
  }
  'settings:updateProfile': {
    request: [string, Partial<Record<string, unknown>>]
    response: { success: boolean }
  }
  'settings:removeProfile': {
    request: string
    response: { success: boolean }
  }
  'settings:setActiveProfile': {
    request: string
    response: { success: boolean }
  }
  'settings:addDirectory': {
    request: string
    response: { success: boolean }
  }
  'settings:removeDirectory': {
    request: string
    response: { success: boolean }
  }
  'settings:reorderDirectories': {
    request: string[]
    response: { success: boolean }
  }
  'settings:getTheme': {
    request: void
    response: 'light' | 'dark' | 'system'
  }
  'settings:setTheme': {
    request: 'light' | 'dark' | 'system'
    response: { success: boolean }
  }
  'settings:testConnection': {
    request: { baseUrl: string; apiKey: string; model: string }
    response: { success: boolean; message: string }
  }

  // Memory
  'memory:list': {
    request: void
    response: Array<{ name: string; path: string }>
  }
  'memory:read': {
    request: string
    response: { success: boolean; content?: string; error?: string }
  }
  'memory:write': {
    request: [string, string]
    response: { success: boolean; error?: string }
  }
  'memory:delete': {
    request: string
    response: { success: boolean; error?: string }
  }

  // Graph
  'graph:getData': {
    request: void
    response: GraphData
  }

  // Cron
  'cron:register': {
    request: [string, string, string?]
    response: { success: boolean; task?: unknown; error?: string }
  }
  'cron:list': {
    request: void
    response: unknown[]
  }
  'cron:remove': {
    request: string
    response: boolean
  }
  'cron:execute': {
    request: string
    response: { success: boolean; result?: string; error?: string }
  }

  // Skills
  'skills:list': {
    request: void
    response: unknown[]
  }

  // Search
  'search:query': {
    request: string
    response: unknown[]
  }

  // Notification
  'notification:getHistory': {
    request: void
    response: unknown[]
  }

  // Ping
  'ping': {
    request: void
    response: string
  }
}

// ─── Event (Push) Channels ──────────────────────────────────────────

export type IPCEventMap = {
  'agent:event': AgentIPCMessage
  'agent:sessionCreated': string
  'agent:permissionRequest': PermissionRequestIPC
  'agent:askUser': AskUserRequestIPC
  'agent:askUserTimeout': { requestId: string; context: string }
  'agent:permissionTimeout': { requestId: string; context: string }
  'agent:notification': { type: string; message: string; title: string }
  'settings:changed': Record<string, unknown>
  'graph:filesChanged': { count: number; files: string[] }
  'cron:taskCompleted': unknown
  'menu-action': string
}

// ─── Helper: extract request/response types ─────────────────────────

export type IPCRequest<K extends keyof IPCChannelMap> = IPCChannelMap[K]['request']
export type IPCResponse<K extends keyof IPCChannelMap> = IPCChannelMap[K]['response']
export type IPCEventPayload<K extends keyof IPCEventMap> = IPCEventMap[K]