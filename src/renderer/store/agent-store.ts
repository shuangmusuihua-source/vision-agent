import type {
  AgentIPCMessage,
  AgentState,
  AgentEvent,
  ConversationMessage,
  ContentBlock,
  ToolCallState,
  ArtifactData,
  ArtifactFileType,
  UsageInfo,
  PermissionRequestIPC,
  AskUserRequestIPC,
  SdkSessionInfo,
  StreamingAccumulator,
} from '../../shared/types'

// ─── Agent Store Interface ─────────────────────────────────────────

export type AgentStore = {
  // Public state
  messages: ConversationMessage[]
  isStreaming: boolean
  agentState: AgentState
  currentSessionId: string | null
  usageInfo: UsageInfo | null
  lastEditedFile: string | null
  permissionRequest: PermissionRequestIPC | null
  askUserRequest: AskUserRequestIPC | null
  activeSkillId: string | null
  sessionList: SdkSessionInfo[]

  // Internal state (not for UI consumption)
  _acc: StreamingAccumulator | null
  _firstContentSeen: boolean

  // Actions
  dispatchAgentEvent: (event: AgentEvent) => void
  processIPCMessage: (msg: AgentIPCMessage, options?: { isReplay?: boolean }) => void
  handlePermissionRequest: (req: PermissionRequestIPC) => void
  handlePermissionResponse: (requestId: string, behavior: 'allow' | 'deny') => void
  handleAskUserRequest: (req: AskUserRequestIPC) => void
  handleAskUserResponse: (requestId: string, answer: string) => void
  handleAskUserTimeout: (requestId: string) => void
}

// ─── Backward-compatible type aliases ────────────────────────────────

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
  AskUserQuestionOption,
} from '../../shared/types'