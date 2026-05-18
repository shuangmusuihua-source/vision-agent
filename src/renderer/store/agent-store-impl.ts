import { create } from 'zustand'
import type { ChatMessage, ToolCall, AgentState, AgentStatus, UsageInfo, PermissionRequest, SdkSessionInfo } from './agent-store'
import type { AskUserRequest } from '../lib/ipc'

export const useAgentStore = create<AgentState>((set) => ({
  messages: [],
  isStreaming: false,
  currentSessionId: null,
  agentStatus: 'idle',
  usageInfo: null,
  permissionRequest: null,
  askUserRequest: null,
  sessionList: [],
  lastEditedFile: null,
  lastEditedFileTime: 0,

  addMessage: (message: ChatMessage) =>
    set((state) => ({ messages: [...state.messages, message] })),

  updateLastAssistantMessage: (content: string) =>
    set((state) => {
      const messages = [...state.messages]
      const lastIdx = messages.findLastIndex((m) => m.role === 'assistant')
      if (lastIdx >= 0) {
        messages[lastIdx] = { ...messages[lastIdx], content, isStreaming: true }
      }
      return { messages }
    }),

  appendToLastAssistantMessage: (chunk: string) =>
    set((state) => {
      const messages = [...state.messages]
      const lastIdx = messages.findLastIndex((m) => m.role === 'assistant')
      if (lastIdx >= 0) {
        messages[lastIdx] = {
          ...messages[lastIdx],
          content: messages[lastIdx].content + chunk,
          isStreaming: true
        }
      }
      return { messages }
    }),

  replaceLastAssistantMessage: (content: string) =>
    set((state) => {
      const messages = [...state.messages]
      const lastIdx = messages.findLastIndex((m) => m.role === 'assistant')
      if (lastIdx >= 0) {
        messages[lastIdx] = {
          ...messages[lastIdx],
          content,
          isStreaming: true,
          isStatusIndicator: false
        }
      }
      return { messages }
    }),

  finishStreaming: () =>
    set((state) => {
      const messages = state.messages
        .filter((m) => !(m.isStatusIndicator && m.isStreaming))
        .map((m) =>
          m.isStreaming ? { ...m, isStreaming: false } : m
        )
      return { messages, isStreaming: false, agentStatus: 'idle' }
    }),

  setToolCall: (messageId: string, toolCall: ToolCall) =>
    set((state) => {
      const messages = [...state.messages]
      const idx = messages.findIndex((m) => m.id === messageId)
      if (idx >= 0) {
        const existing = messages[idx].toolCalls || []
        const updated = existing.map((tc) =>
          tc.toolUseId === toolCall.toolUseId ? toolCall : tc
        )
        if (!existing.some((tc) => tc.toolUseId === toolCall.toolUseId)) {
          updated.push(toolCall)
        }
        messages[idx] = { ...messages[idx], toolCalls: updated }
      }
      return { messages }
    }),

  updateToolCallResult: (messageId: string, toolUseId: string, result: string, status: 'completed' | 'error') =>
    set((state) => {
      const messages = [...state.messages]
      const idx = messages.findIndex((m) => m.id === messageId)
      if (idx >= 0) {
        const toolCalls = (messages[idx].toolCalls || []).map((tc) =>
          tc.toolUseId === toolUseId ? { ...tc, result, status } : tc
        )
        messages[idx] = { ...messages[idx], toolCalls }
      }
      return { messages }
    }),

  setStreaming: (streaming: boolean) => set({ isStreaming: streaming }),

  setSessionId: (id: string | null) => set({ currentSessionId: id }),

  setAgentStatus: (status: AgentStatus) => set({ agentStatus: status }),

  setUsageInfo: (info: UsageInfo | null) => set({ usageInfo: info }),

  setPermissionRequest: (request: PermissionRequest | null) => set({ permissionRequest: request }),

  setAskUserRequest: (request: AskUserRequest | null) => set({ askUserRequest: request }),

  setSessionList: (sessions: SdkSessionInfo[]) => set({ sessionList: sessions }),

  setLastEditedFile: (path: string | null) => set({ lastEditedFile: path, lastEditedFileTime: Date.now() }),

  clearMessages: () =>
    set({ messages: [], isStreaming: false, currentSessionId: null, agentStatus: 'idle', usageInfo: null, permissionRequest: null, askUserRequest: null, lastEditedFile: null, lastEditedFileTime: 0 })
}))
