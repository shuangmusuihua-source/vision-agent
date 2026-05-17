interface ToolCall {
  toolName: string
  toolUseId: string
  input: Record<string, unknown>
  result?: string
  status: 'running' | 'completed' | 'error'
}

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  toolCalls?: ToolCall[]
  isStreaming?: boolean
  isStatusIndicator?: boolean
}

type AgentStatus = 'idle' | 'thinking' | 'running' | 'compacting' | 'error'

interface UsageInfo {
  inputTokens: number
  outputTokens: number
  costUsd: number
  durationMs: number
}

interface PermissionRequest {
  id: string
  toolName: string
  input: Record<string, unknown>
}

interface SdkSessionInfo {
  id: string
  title?: string
  createdAt?: number
  lastModified?: number
}

interface AgentState {
  messages: ChatMessage[]
  isStreaming: boolean
  currentSessionId: string | null
  agentStatus: AgentStatus
  usageInfo: UsageInfo | null
  permissionRequest: PermissionRequest | null
  sessionList: SdkSessionInfo[]
  lastEditedFile: string | null
  lastEditedFileTime: number
  addMessage: (message: ChatMessage) => void
  updateLastAssistantMessage: (content: string) => void
  appendToLastAssistantMessage: (chunk: string) => void
  replaceLastAssistantMessage: (content: string) => void
  finishStreaming: () => void
  setToolCall: (messageId: string, toolCall: ToolCall) => void
  updateToolCallResult: (messageId: string, toolUseId: string, result: string, status: 'completed' | 'error') => void
  setStreaming: (streaming: boolean) => void
  setSessionId: (id: string | null) => void
  setAgentStatus: (status: AgentStatus) => void
  setUsageInfo: (info: UsageInfo | null) => void
  setPermissionRequest: (request: PermissionRequest | null) => void
  setSessionList: (sessions: SdkSessionInfo[]) => void
  setLastEditedFile: (path: string | null) => void
  clearMessages: () => void
}

export type { ChatMessage, ToolCall, AgentState, AgentStatus, UsageInfo, PermissionRequest, SdkSessionInfo }
