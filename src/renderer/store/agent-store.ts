import type { AskUserOption, AskUserRequest } from '../lib/ipc'

interface ToolCall {
  toolName: string
  toolUseId: string
  input: Record<string, unknown>
  result?: string
  status: 'running' | 'completed' | 'error'
}

interface SkillInfo {
  id: string
  name: string
  icon: string
  status: 'running' | 'completed' | 'error'
  outputFile?: string
  outputContent?: string
}

interface Artifact {
  filePath?: string
  fileName: string
  fileType: 'md' | 'html'
  content?: string
}

interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  toolCalls?: ToolCall[]
  isStreaming?: boolean
  isStatusIndicator?: boolean
  skillInfo?: SkillInfo
  artifact?: Artifact
  skillOutputContent?: string
}

type AgentStatus = 'idle' | 'thinking' | 'running' | 'compacting' | 'error' | 'waitingForUserInput'

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
  askUserRequest: AskUserRequest | null
  sessionList: SdkSessionInfo[]
  lastEditedFile: string | null
  lastEditedFileTime: number
  activeSkillInfo: SkillInfo | null
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
  setAskUserRequest: (request: AskUserRequest | null) => void
  setSessionList: (sessions: SdkSessionInfo[]) => void
  setLastEditedFile: (path: string | null) => void
  setActiveSkillInfo: (info: SkillInfo | null) => void
  updateArtifactFilePath: (messageId: string, filePath: string) => void
  clearMessages: () => void
}

export type { ChatMessage, ToolCall, SkillInfo, Artifact, AgentState, AgentStatus, UsageInfo, PermissionRequest, SdkSessionInfo }
