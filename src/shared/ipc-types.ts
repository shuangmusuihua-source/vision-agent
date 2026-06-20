// IPC channel type mapping — single source of truth for
// request/response shapes and event payloads across Main/Preload/Renderer.

import type {
  AgentIPCMessage,
  AgentIPCMessageWithContext,
  AgentSessionEnvelope,
  ModelProfile,
  SdkSessionInfo,
  SessionRoutedAskUserRequest,
  SessionRoutedPermissionRequest,
  SessionRoutedRequestTimeout,
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
      workspacePath?: string
      clientSessionKey?: string
    }
    response: { started: boolean }
  }
  'agent:abort': {
    request: string | undefined
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
      options?: { updatedPermissions?: Array<Record<string, unknown>>; decisionClassification?: 'user_temporary' | 'user_permanent' | 'user_reject' }
    }
    response: { success: boolean }
  }
  'agent:setPermissionMode': {
    request: { context: 'editor' | 'ask'; mode: string }
    response: { success: boolean }
  }
  'agent:forkSession': {
    request: { sessionId: string; options?: { upToMessageId?: string; title?: string } }
    response: { success: boolean; sessionId?: string; error?: string }
  }
  'agent:respondAskUser': {
    request: {
      requestId: string
      answers: Record<string, string>
    }
    response: { success: boolean }
  }
  'agent:listSdkSessions': {
    request: string | undefined
    response: SdkSessionInfo[]
  }
  'agent:loadSessionMessages': {
    request: { sessionId: string }
    response: AgentIPCMessage[]
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
    request: ModelProfile
    response: { success: boolean }
  }
  'settings:updateProfile': {
    request: [string, Partial<ModelProfile>]
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
  'agent:event': AgentIPCMessageWithContext
  'agent:sessionCreated': AgentSessionEnvelope
  'agent:permissionRequest': SessionRoutedPermissionRequest
  'agent:askUser': SessionRoutedAskUserRequest
  'agent:askUserTimeout': SessionRoutedRequestTimeout
  'agent:permissionTimeout': SessionRoutedRequestTimeout
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
