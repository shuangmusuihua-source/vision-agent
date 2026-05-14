interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  toolCalls?: ToolCall[]
  isStreaming?: boolean
}

interface ToolCall {
  toolName: string
  input: Record<string, unknown>
  result?: string
  status: 'running' | 'completed' | 'error'
}

interface AgentState {
  messages: ChatMessage[]
  isStreaming: boolean
  currentSessionId: string | null
  addMessage: (message: ChatMessage) => void
  updateLastAssistantMessage: (content: string) => void
  finishStreaming: () => void
  setToolCall: (messageId: string, toolCall: ToolCall) => void
  setStreaming: (streaming: boolean) => void
  setSessionId: (id: string | null) => void
  clearMessages: () => void
}

export type { ChatMessage, ToolCall, AgentState }