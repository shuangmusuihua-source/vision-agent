import type {
  AgentContext,
  AgentIPCMessage,
  AgentState,
  AgentEvent,
  ConversationMessage,
  UsageInfo,
  PermissionRequestIPC,
  AskUserRequestIPC,
  SdkSessionInfo,
  StreamingAccumulator,
  SkillOutputState,
  TodoTaskList,
  WorkspaceRecord,
  WorkspaceDigest,
  SessionOutputs,
} from '../../shared/types'
import type { SessionListAction } from './session-protocol'

// ─── Context Slot (per agent instance) ────────────────────────────────────

export type ContextSlot = {
  messages: ConversationMessage[]
  /** App-owned stable session key used for renderer routing. */
  currentSessionId: string | null
  /** Claude SDK session_id used for resume/history/delete operations. */
  sdkSessionId: string | null
  isStreaming: boolean
  agentState: AgentState
  usageInfo: UsageInfo | null
  permissionRequest: PermissionRequestIPC | null
  permissionQueue: PermissionRequestIPC[]
  askUserRequest: AskUserRequestIPC | null
  askUserQueue: AskUserRequestIPC[]
  skillOutput: SkillOutputState | null
  activeSkillId: string | null
  lastEditedFile: string | null
  linkedFile: string | null
  prefillText: string | null
  ttftMs: number | null
  todoList: TodoTaskList | null
  workspacePath: string | null
  _needsSdkLoad: boolean
  _sdkLoadedCount: number
  _sdkLoadOffset: number
  _isLoadingMoreMessages: boolean
  _acc: StreamingAccumulator | null
  _firstContentSeen: boolean
  _processedArtifactIds: Set<string>
  _queryGeneration: number
  _resultGuardGen: number
}

function emptySlot(): ContextSlot {
  return {
    messages: [],
    currentSessionId: null,
    sdkSessionId: null,
    isStreaming: false,
    agentState: 'idle',
    usageInfo: null,
    permissionRequest: null,
    permissionQueue: [],
    askUserRequest: null,
    askUserQueue: [],
    skillOutput: null,
    activeSkillId: null,
    lastEditedFile: null,
    linkedFile: null,
    prefillText: null,
    ttftMs: null,
    todoList: null,
    workspacePath: null,
    _needsSdkLoad: false,
    _sdkLoadedCount: 0,
    _sdkLoadOffset: 0,
    _isLoadingMoreMessages: false,
    _acc: null,
    _firstContentSeen: false,
    _processedArtifactIds: new Set(),
    _queryGeneration: 0,
    _resultGuardGen: 0,
  }
}

export { emptySlot }

// ─── Agent Store Interface ─────────────────────────────────────────────

export type AgentStore = {
  // Active context — determines which slot is "current"
  context: AgentContext

  // Per-context state slots
  slots: Record<AgentContext, ContextSlot>

  // Per-session isolated slots (keyed by session ID)
  sessionSlots: Record<string, ContextSlot>

  // LRU access order for session eviction — most-recently-accessed at the end
  sessionAccessOrder: string[]

  // Shared state (not context-specific)
  isResumingSession: boolean
  sessionList: SdkSessionInfo[]

  // Workspace state
  activeWorkspacePath: string | null
  workspaceDigest: WorkspaceDigest | null
  workspaceDigestLoading: boolean

  // Session state (sidebar + overview) — per-context to avoid editor/ask collision
  activeSessionId: { editor: string | null; ask: string | null }
  sessionOutputs: SessionOutputs | null
  sessionOutputsLoading: boolean

  // Actions
  dispatchAgentEvent: (event: AgentEvent, context?: AgentContext, eventSid?: string | null) => void
  processIPCMessage: (msg: AgentIPCMessage & { context?: AgentContext; sessionId?: string; clientSessionKey?: string; sdkSessionId?: string }, options?: { isReplay?: boolean }) => void
  handlePermissionRequest: (req: PermissionRequestIPC) => void
  handlePermissionResponse: (requestId: string, behavior: 'allow' | 'deny') => void
  handleAskUserRequest: (req: AskUserRequestIPC) => void
  handleAskUserResponse: (requestId: string, answers: Record<string, string>) => void
  handleAskUserTimeout: (requestId: string) => void
  handlePermissionTimeout: (requestId: string) => void
  handleSkillOutput: (state: SkillOutputState) => void
  setPrefill: (context: AgentContext, text: string) => void
  consumePrefill: (context: AgentContext) => void
  setActiveWorkspace: (path: string | null) => void
  setWorkspaceDigest: (digest: WorkspaceDigest | null) => void
  setActiveSession: (sessionId: string | null, context?: AgentContext) => void
  setSessionOutputs: (outputs: SessionOutputs | null) => void
  dispatchSessionList: (action: SessionListAction) => void
  switchToSession: (sessionId: string, context?: AgentContext, workspacePath?: string | null) => void
  ensureSessionSlot: (sessionId: string) => void
  loadInitialSessionMessages: (sessionId: string, context?: AgentContext) => Promise<void>
  loadMoreSessionMessages: (sessionId: string) => Promise<void>
  renameCurrentSession: (title: string) => Promise<void>
}

// ─── Backward-compatible type aliases ────────────────────────────────────

export type {
  ConversationMessage as ChatMessage,
  ToolCallState as ToolCall,
  SkillMeta as SkillInfo,
  ArtifactData,
  MessagePhase,
  UsageInfo,
  PermissionRequestIPC as PermissionRequest,
  AskUserRequestIPC as AskUserRequest,
  SdkSessionInfo as SdkSessionInfo,
} from '../../shared/types'

// Re-export types that components reference from this module
export type {
  AgentContext,
  AskUserQuestionOption,
  SkillOutputState,
} from '../../shared/types'
