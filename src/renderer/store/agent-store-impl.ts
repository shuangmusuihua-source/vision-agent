import { create } from 'zustand'
import type { ChatMessage, ToolCall, SkillInfo, AgentState, AgentStatus, UsageInfo, PermissionRequest, SdkSessionInfo } from './agent-store'
import type { AskUserRequest } from '../lib/ipc'

function extractSkillOutputContent(messages: ChatMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.role === 'assistant' && msg.content) {
      const match = msg.content.match(/```skill-output\n([\s\S]*?)```/)
      if (match) return match[1]
    }
  }
  return null
}

function extractPartialSkillOutput(content: string): string | null {
  const startIdx = content.indexOf('```skill-output\n')
  if (startIdx === -1) return null
  const contentStart = startIdx + '```skill-output\n'.length
  const endIdx = content.indexOf('```', contentStart)
  if (endIdx !== -1) return content.substring(contentStart, endIdx)
  return content.substring(contentStart)
}

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

  appendToLastAssistantMessage: (chunk: string) =>
    set((state) => {
      const messages = [...state.messages]
      const lastIdx = messages.findLastIndex((m) => m.role === 'assistant')
      if (lastIdx >= 0) {
        const msg = { ...messages[lastIdx], content: messages[lastIdx].content + chunk, isStreaming: true }

        // Detect skill-output code block content
        const skillOutputMatch = msg.content.match(/```skill-output\n([\s\S]*?)```/)
        if (skillOutputMatch) {
          msg.skillOutputContent = skillOutputMatch[1]
          console.log('[Store] append: skill-output COMPLETE detected, len:', skillOutputMatch[1].length)
        } else {
          const partialMatch = msg.content.match(/```skill-output\n([\s\S]*)$/)
          if (partialMatch) {
            msg.skillOutputContent = partialMatch[1]
            console.log('[Store] append: skill-output PARTIAL detected, len:', partialMatch[1].length)
          }
        }

        messages[lastIdx] = msg
      }
      return { messages }
    }),

  replaceLastAssistantMessage: (content: string) =>
    set((state) => {
      const messages = [...state.messages]
      const lastIdx = messages.findLastIndex((m) => m.role === 'assistant')
      if (lastIdx >= 0) {
        const msg = {
          ...messages[lastIdx],
          content,
          isStreaming: true,
          isStatusIndicator: false
        }

        // Detect skill-output code block content
        const skillOutputMatch = msg.content.match(/```skill-output\n([\s\S]*?)```/)
        if (skillOutputMatch) {
          msg.skillOutputContent = skillOutputMatch[1]
          console.log('[Store] replaceLast: skill-output COMPLETE detected, len:', skillOutputMatch[1].length)
        } else {
          const partialMatch = msg.content.match(/```skill-output\n([\s\S]*)$/)
          if (partialMatch) {
            msg.skillOutputContent = partialMatch[1]
            console.log('[Store] replaceLast: skill-output PARTIAL detected, len:', partialMatch[1].length)
          }
        }

        messages[lastIdx] = msg
      }
      return { messages }
    }),

  finishStreaming: () =>
    set((state) => {
      if (!state.isStreaming) return state
      const outputFile = state.lastEditedFile || undefined
      const messages = state.messages
        .filter((m) => !(m.isStatusIndicator && m.isStreaming))
        .map((m) =>
          m.isStreaming ? { ...m, isStreaming: false } : m
        )
        .map((m) =>
          m.skillInfo && m.skillInfo.status === 'running'
            ? { ...m, skillInfo: { ...m.skillInfo, status: 'completed' as const, outputFile } }
            : m
        )

      // Prefer skill-output code block content over Write-produced file
      const skillContent = extractSkillOutputContent(messages)
      console.log('[Store] finishStreaming: skillContent=', !!skillContent, 'outputFile=', outputFile, 'activeSkillInfo=', !!state.activeSkillInfo)
      if (skillContent) {
        // Clear outputFile on skill messages to avoid duplicate artifact in SkillCard
        for (let i = 0; i < messages.length; i++) {
          if (messages[i].skillInfo?.outputFile) {
            console.log('[Store] Clearing outputFile on message', messages[i].id)
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
        // Clear outputFile on skill messages to avoid duplicate artifact in SkillCard
        for (let i = 0; i < messages.length; i++) {
          if (messages[i].skillInfo?.outputFile) {
            messages[i] = { ...messages[i], skillInfo: { ...messages[i].skillInfo!, outputFile: undefined } }
          }
        }
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

      return { messages, isStreaming: false, agentStatus: 'idle', activeSkillInfo: null }
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
    set({ messages: [], isStreaming: false, currentSessionId: null, agentStatus: 'idle', usageInfo: null, permissionRequest: null, askUserRequest: null, lastEditedFile: null, lastEditedFileTime: 0, activeSkillInfo: null })
}))
