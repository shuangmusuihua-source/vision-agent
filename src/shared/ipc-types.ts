// IPC channel type mapping — single source of truth for
// request/response shapes and event payloads across Main/Preload/Renderer.

import type {
  AgentIPCMessage,
  AgentIPCMessageWithContext,
  AgentSessionEnvelope,
  AgentNotificationEvent,
  ModelProfile,
  SdkSessionInfo,
  SessionOutputs,
  SessionRoutedAskUserRequest,
  SessionRoutedPermissionRequest,
  SessionRoutedRequestTimeout,
  SessionRoutedGenerationActivity,
  GraphData,
  BuiltinSkillCatalogItem,
  CommunitySkillCatalogItem,
  CommunitySkillMutationResult,
  InlineRewriteRequest,
  InlineRewriteResponse,
  MemoryDocument,
  MemoryEntry,
} from './types'
import type {
  MarkitdownFormat,
  MarkitdownRuntimeInstallResult,
  MarkitdownRuntimeStatus,
} from './markitdown-runtime'
import type {
  OfficeCliRuntimeInstallResult,
  OfficeCliRuntimeStatus,
} from './officecli-runtime'
import type {
  UpdateCheckResult,
  UpdateDownloadProgress,
  UpdateErrorPayload,
} from './update-types'
import type {
  CronScheduleParseRequest,
  CronScheduleParseResponse,
  CronTask,
  CronTaskCompletedEvent,
  CronTaskRegistration,
} from './cron-types'

// ─── Request/Response Channels ───────────────────────────────────────

export type IPCChannelMap = {
  // App
  'app:getVersion': {
    request: void
    response: string
  }

  // Agent
  'agent:sendMessage': {
    request: {
      prompt: string
      sessionId?: string
      activeFilePath?: string
      skillId?: string
      context?: 'editor' | 'ask'
      workspacePath?: string
      title?: string
      clientSessionKey?: string
      approvalMode?: import('./types').AgentApprovalMode
    }
    response: { started: boolean }
  }
  'agent:abort': {
    request: { contextOrSessionId?: string }
    response: { success: boolean }
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
    request: { queryKey: string; mode: import('./types').AgentApprovalMode }
    response: { success: boolean; error?: string }
  }
  'agent:respondAskUser': {
    request: {
      requestId: string
      answers: Record<string, string>
    }
    response: { success: boolean }
  }
  'agent:listSdkSessions': {
    request: { workspaceCwd?: string }
    response: SdkSessionInfo[]
  }
  'agent:loadSessionMessagesPaginated': {
    request: { sessionId: string; limit: number; offset: number }
    response: { messages: AgentIPCMessage[]; offset: number; limit: number; hasMore: boolean }
  }
  'agent:renameSession': {
    request: { sessionId: string; title: string }
    response: { success: boolean }
  }
  'agent:updateSessionRecord': {
    request: {
      sessionId: string
      patch: { title?: string; workspacePath: string; context: 'editor' }
    }
    response: { success: boolean; error?: string }
  }
  'agent:removeSessionRecord': {
    request: { sessionId: string }
    response: { success: boolean }
  }
  'agent:deleteSession': {
    request: { sessionId: string }
    response: { success: boolean }
  }
  'agent:getSessionOutputs': {
    request: { sessionId: string }
    response: SessionOutputs | null
  }
  'agent:revealSessionOutput': {
    request: { sessionId: string; filePath: string }
    response: { success: boolean; error?: string }
  }
  'agent:openSessionOutput': {
    request: { sessionId: string; filePath: string }
    response: { success: boolean; error?: string }
  }
  'agent:deleteSessionOutput': {
    request: { sessionId: string; filePath: string }
    response: { success: boolean; error?: string }
  }

  // Editor
  'editor:prepareRewrite': {
    request: Pick<InlineRewriteRequest, 'requestId' | 'filePath'>
    response: { prepared: boolean }
  }
  'editor:rewriteSelection': {
    request: InlineRewriteRequest
    response: InlineRewriteResponse
  }
  'editor:cancelRewrite': {
    request: { requestId: string }
    response: { cancelled: boolean }
  }

  // Workspace
  'workspace:readFile': {
    request: string
    response: { success: boolean; content?: string; error?: string }
  }
  'workspace:writeFile': {
    request: [string, string]
    response: { success: boolean; error?: string }
  }
  'workspace:savePastedImage': {
    request: { documentPath: string; mimeType: string; bytes: Uint8Array }
    response: { success: boolean; relativePath?: string; error?: string }
  }
  'workspace:readImageAsset': {
    request: { documentPath: string; relativePath: string }
    response: { success: boolean; mimeType?: string; bytes?: Uint8Array; error?: string }
  }
  'workspace:addToKnowledge': {
    request: { sourcePath: string; sessionId?: string }
    response: {
      success: boolean
      filePath?: string
      fileName?: string
      alreadyExists?: boolean
      updated?: boolean
      error?: string
    }
  }
  'workspace:listMarkdownFiles': {
    request: string
    response: Array<{ label: string; path: string }>
  }
  'workspace:createWorkspace': {
    request: string
    response: string | null
  }
  'workspace:deleteWorkspace': {
    request: string
    response: { success: boolean; error?: string }
  }
  'workspace:knowledgeDir': {
    request: void
    response: string
  }
  'workspace:selectFiles': {
    request: void
    response: { canceled: boolean; filePaths: string[]; attachmentGrantId?: string }
  }
  'workspace:openInBrowser': {
    request: string
    response: void
  }
  'workspace:openExternalUrl': {
    request: string
    response: { success: boolean }
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
  'settings:removeDirectory': {
    request: string
    response: { success: boolean }
  }
  'settings:reorderDirectories': {
    request: string[]
    response: { success: boolean }
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
    response: MemoryEntry[]
  }
  'memory:read': {
    request: string
    response: { success: boolean; document?: MemoryDocument; error?: string }
  }
  'memory:update': {
    request: { filePath: string; content: string }
    response: { success: boolean; document?: MemoryDocument; error?: string }
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
  'graph:acknowledgeChanges': {
    request: number
    response: { count: number; files: string[]; version: number }
  }

  // Cron
  'cron:register': {
    request: CronTaskRegistration
    response: { success: boolean; task?: CronTask; error?: string }
  }
  'cron:selectDirectory': {
    request: void
    response: { canceled: boolean; filePaths: string[] }
  }
  'cron:list': {
    request: void
    response: CronTask[]
  }
  'cron:resolveSchedule': {
    request: CronScheduleParseRequest
    response: CronScheduleParseResponse
  }
  'cron:remove': {
    request: string
    response: boolean
  }
  'cron:execute': {
    request: string
    response: { success: boolean; result?: string; error?: string }
  }
  'cron:stop': {
    request: string
    response: { success: boolean; error?: string }
  }
  'cron:setStatus': {
    request: { taskId: string; status: CronTask['status'] }
    response: { success: boolean; task?: CronTask; error?: string }
  }

  // Skills
  'skills:list': {
    request: void
    response: unknown[]
  }
  'skills:toggle': {
    request: [string, boolean]
    response: string[]
  }
  'skills:builtins': {
    request: void
    response: BuiltinSkillCatalogItem[]
  }
  'skills:catalog': {
    request: void
    response: CommunitySkillCatalogItem[]
  }
  'skills:install': {
    request: string
    response: CommunitySkillMutationResult
  }
  'skills:update': {
    request: string
    response: CommunitySkillMutationResult
  }
  'skills:uninstall': {
    request: string
    response: CommunitySkillMutationResult
  }

  // Attachment conversion runtime
  'attachments:runtimeStatus': {
    request: { formats?: MarkitdownFormat[] }
    response: MarkitdownRuntimeStatus
  }
  'attachments:installRuntime': {
    request: void
    response: MarkitdownRuntimeInstallResult
  }

  // Managed OfficeCLI runtime
  'office:runtimeStatus': {
    request: void
    response: OfficeCliRuntimeStatus
  }
  'office:installRuntime': {
    request: void
    response: OfficeCliRuntimeInstallResult
  }

  // Search
  'search:query': {
    request: string
    response: unknown[]
  }

  // Update
  'update:checkForUpdates': {
    request: void
    response: UpdateCheckResult
  }
  'update:download': {
    request: void
    response: void
  }
  'update:install': {
    request: void
    response: void
  }
  'update:openLatestRelease': {
    request: void
    response: void
  }
}

// ─── Event (Push) Channels ──────────────────────────────────────────

export type IPCEventMap = {
  'agent:event': AgentIPCMessageWithContext
  'agent:sessionCreated': AgentSessionEnvelope
  'agent:sessionFilesChanged': AgentSessionEnvelope
  'agent:permissionRequest': SessionRoutedPermissionRequest
  'agent:askUser': SessionRoutedAskUserRequest
  'agent:askUserTimeout': SessionRoutedRequestTimeout
  'agent:permissionTimeout': SessionRoutedRequestTimeout
  'agent:notification': AgentNotificationEvent
  'agent:generationActivity': SessionRoutedGenerationActivity
  'skills:changed': { skillId: string; reason: 'installed' | 'updated' | 'uninstalled' | 'toggled' }
  'settings:changed': Record<string, unknown>
  'graph:filesChanged': { count: number; files: string[]; version: number }
  'cron:taskCompleted': CronTaskCompletedEvent
  'menu-action': string
  'main:error': { type: 'unhandledRejection' | 'uncaughtException'; message: string }
  'update:available': { version: string }
  'update:downloaded': void
  'update:download-progress': UpdateDownloadProgress
  'update:error': UpdateErrorPayload
}

// ─── Helper: extract request/response types ─────────────────────────

export type IPCRequest<K extends keyof IPCChannelMap> = IPCChannelMap[K]['request']
export type IPCResponse<K extends keyof IPCChannelMap> = IPCChannelMap[K]['response']
export type IPCEventPayload<K extends keyof IPCEventMap> = IPCEventMap[K]
