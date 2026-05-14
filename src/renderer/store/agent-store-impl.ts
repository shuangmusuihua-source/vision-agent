import { create } from 'zustand'
import type { ChatMessage, ToolCall, AgentState } from './agent-store'

const useAgentStore = create<AgentState>((set) => ({
  messages: [],
  isStreaming: false,
  currentSessionId: null,

  addMessage: (message: ChatMessage) =>
    set((state) => ({ messages: [...state.messages, message] })),

  updateLastAssistantMessage: (content: string) =>
    set((state) => {
      const messages = [...state.messages]
      const lastIdx = messages.length - 1
      if (lastIdx >= 0 && messages[lastIdx].role === 'assistant') {
        messages[lastIdx] = { ...messages[lastIdx], content }
      }
      return { messages }
    }),

  setToolCall: (messageId: string, toolCall: ToolCall) =>
    set((state) => {
      const messages = [...state.messages]
      const msg = messages.find((m) => m.id === messageId)
      if (msg) {
        const toolCalls = [...(msg.toolCalls || [])]
        const existingIdx = toolCalls.findIndex(
          (tc) => tc.toolName === toolCall.toolName
        )
        if (existingIdx >= 0) {
          toolCalls[existingIdx] = toolCall
        } else {
          toolCalls.push(toolCall)
        }
        msg.toolCalls = toolCalls
      }
      return { messages }
    }),

  setStreaming: (streaming: boolean) => set({ isStreaming: streaming }),

  setSessionId: (id: string | null) => set({ currentSessionId: id }),

  clearMessages: () => set({ messages: [], currentSessionId: null })
}))

export default useAgentStore