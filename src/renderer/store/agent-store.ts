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
}

type AgentStatus = 'idle' | 'thinking' | 'running' | 'compacting' | 'error'

interface UsageInfo {
  inputTokens: number
  outputTokens: number
  costUsd: number
  durationMs: number
}

interface AgentState {
  messages: ChatMessage[]
  isStreaming: boolean
  currentSessionId: string | null
  agentStatus: AgentStatus
  usageInfo: UsageInfo | null
  addMessage: (message: ChatMessage) => void
  updateLastAssistantMessage: (content: string) => void
  appendToLastAssistantMessage: (chunk: string) => void
  finishStreaming: () => void
  setToolCall: (messageId: string, toolCall: ToolCall) => void
  updateToolCallResult: (messageId: string, toolUseId: string, result: string, status: 'completed' | 'error') => void
  setStreaming: (streaming: boolean) => void
  setSessionId: (id: string | null) => void
  setAgentStatus: (status: AgentStatus) => void
  setUsageInfo: (info: UsageInfo | null) => void
  clearMessages: () => void
}

export type { ChatMessage, ToolCall, AgentState, AgentStatus, UsageInfo }
