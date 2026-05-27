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
} from '../../shared/types'

// ─── Context Slot (per agent instance) ────────────────────────────────────

export type ContextSlot = {
  messages: ConversationMessage[]
  currentSessionId: string | null
  isStreaming: boolean
  agentState: AgentState
  usageInfo: UsageInfo | null
  permissionRequest: PermissionRequestIPC | null
  askUserRequest: AskUserRequestIPC | null
  skillOutput: SkillOutputState | null
  activeSkillId: string | null
  lastEditedFile: string | null
  _acc: StreamingAccumulator | null
  _firstContentSeen: boolean
}

function emptySlot(): ContextSlot {
  return {
    messages: [],
    currentSessionId: null,
    isStreaming: false,
    agentState: 'idle',
    usageInfo: null,
    permissionRequest: null,
    askUserRequest: null,
    skillOutput: null,
    activeSkillId: null,
    lastEditedFile: null,
    _acc: null,
    _firstContentSeen: false,
  }
}

export { emptySlot }

// ─── Agent Store Interface ─────────────────────────────────────────────

export type AgentStore = {
  // Active context — determines which slot is "current"
  context: AgentContext

  // Per-context state slots
  slots: Record<AgentContext, ContextSlot>

  // Shared state (not context-specific)
  isResumingSession: boolean
  sessionList: SdkSessionInfo[]

  // Actions
  dispatchAgentEvent: (event: AgentEvent, context?: AgentContext) => void
  processIPCMessage: (msg: AgentIPCMessage & { context?: AgentContext }, options?: { isReplay?: boolean }) => void
  handlePermissionRequest: (req: PermissionRequestIPC) => void
  handlePermissionResponse: (requestId: string, behavior: 'allow' | 'deny') => void
  handleAskUserRequest: (req: AskUserRequestIPC) => void
  handleAskUserResponse: (requestId: string, answer: string) => void
  handleAskUserTimeout: (requestId: string) => void
  handleSkillOutput: (state: SkillOutputState) => void
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