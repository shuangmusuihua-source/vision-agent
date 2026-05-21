import { create } from 'zustand'
import type { ChatMessage, ToolCall, SkillInfo, AgentState, AgentStatus, UsageInfo, PermissionRequest, SdkSessionInfo } from './agent-store'
import type { AskUserRequest } from '../lib/ipc'

function extractSkillOutputContent(content: string): string | null {
  const match = content.match(/```skill-output\n([\s\S]*?)```/)
  if (match) return match[1]
  // Partial (unclosed) block
  const partialMatch = content.match(/```skill-output\n([\s\S]*)$/)
  if (partialMatch) return partialMatch[1]
  return null
}

export const useAgentStore = create<AgentState>((set) => ({
  messages: [],
  streamingContent: '',
  isStreaming: false,
  currentSessionId: null,
  agentStatus: 'idle',
  usageInfo: null,
  permissionRequest: null,
  askUserRequest: null,
  sessionList: [],
  lastEditedFile: null,
  lastEditedFileTime: 0,
  activeSkillInfo: null,

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

  // Streaming content — independent of messages array, no re-render cascade
  appendStreamingContent: (chunk: string) =>
    set((state) => ({ streamingContent: state.streamingContent + chunk })),

  clearStreamingContent: () =>
    set({ streamingContent: '' }),

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
      if (!state.isStreaming) return state

      const streamingContent = state.streamingContent
      const outputFile = state.lastEditedFile || undefined

      // Commit streaming content into the last assistant message
      let messages = state.messages
        .filter((m) => !(m.isStatusIndicator && m.isStreaming))
        .map((m) =>
          m.isStreaming ? { ...m, isStreaming: false } : m
        )

      // If there's streaming content, write it into the last assistant message
      if (streamingContent) {
        const lastIdx = messages.findLastIndex((m) => m.role === 'assistant')
        if (lastIdx >= 0) {
          messages[lastIdx] = { ...messages[lastIdx], content: streamingContent }
        }
      }

      // Update skill status
      messages = messages.map((m) =>
        m.skillInfo && m.skillInfo.status === 'running'
          ? { ...m, skillInfo: { ...m.skillInfo, status: 'completed' as const, outputFile } }
          : m
      )

      // Check for skill-output content → create artifact
      const skillContent = extractSkillOutputContent(streamingContent)
      if (skillContent) {
        for (let i = 0; i < messages.length; i++) {
          if (messages[i].skillInfo?.outputFile) {
            messages[i] = { ...messages[i], skillInfo: { ...messages[i].skillInfo!, outputFile: undefined } }
          }
        }
        messages.push({
          id: `artifact-${Date.now()}`,
          role: 'assistant',
          content: '',
          isStreaming: false,
          artifact: {
            fileName: 'presentation.html',
            fileType: 'html',
            content: skillContent
          }
        })
      } else if (outputFile && state.activeSkillInfo) {
        const ext = outputFile.split('.').pop()?.toLowerCase()
        messages.push({
          id: `artifact-${Date.now()}`,
          role: 'assistant',
          content: '',
          isStreaming: false,
          artifact: {
            filePath: outputFile,
            fileName: outputFile.split('/').pop() || outputFile,
            fileType: ext === 'html' || ext === 'htm' ? 'html' : 'md'
          }
        })
      }

      return { messages, streamingContent: '', isStreaming: false, agentStatus: 'idle', activeSkillInfo: null }
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

  setActiveSkillInfo: (info: SkillInfo | null) => set({ activeSkillInfo: info }),

  updateArtifactFilePath: (messageId: string, filePath: string) =>
    set((state) => {
      const messages = [...state.messages]
      const idx = messages.findIndex((m) => m.id === messageId)
      if (idx >= 0 && messages[idx].artifact) {
        messages[idx] = {
          ...messages[idx],
          artifact: { ...messages[idx].artifact!, filePath, content: undefined }
        }
      }
      return { messages }
    }),

  clearMessages: () =>
    set({ messages: [], streamingContent: '', isStreaming: false, currentSessionId: null, agentStatus: 'idle', usageInfo: null, permissionRequest: null, askUserRequest: null, lastEditedFile: null, lastEditedFileTime: 0, activeSkillInfo: null })
}))