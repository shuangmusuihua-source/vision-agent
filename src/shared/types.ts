// Shared types for Agent Panel — used by Main, Preload, and Renderer
// All discriminated unions defined here; no `Record<string, unknown>` downstream.

// ─── Agent Context ────────────────────────────────────────────────────

export type AgentContext = 'editor' | 'ask'

// ─── Model Profile ──────────────────────────────────────────────────

export interface ModelProfile {
  id: string
  name: string
  apiKey: string
  apiProvider: string
  baseUrl: string
  model: string
}

// ─── Content Blocks ──────────────────────────────────────────────────

export type TextBlock = {
  type: 'text'
  text: string
}

export type ToolUseBlock = {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}

export type ToolResultBlock = {
  type: 'tool_result'
  tool_use_id: string
  content: string | unknown[]
  is_error: boolean
}

export type ThinkingBlock = {
  type: 'thinking'
  text: string
}

export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock | ThinkingBlock

// ─── Type Guards ──────────────────────────────────────────────────────

export function isTextBlock(b: ContentBlock): b is TextBlock { return b.type === 'text' }
export function isToolUseBlock(b: ContentBlock): b is ToolUseBlock { return b.type === 'tool_use' }
export function isToolResultBlock(b: ContentBlock): b is ToolResultBlock { return b.type === 'tool_result' }
export function isThinkingBlock(b: ContentBlock): b is ThinkingBlock { return b.type === 'thinking' }

// ─── Stream Event Payloads ───────────────────────────────────────────

export type TextDelta = {
  type: 'text_delta'
  text: string
}

export type InputJsonDelta = {
  type: 'input_json_delta'
  partial_json: string
}

export type StreamContentBlockStart = {
  type: 'content_block_start'
  index: number
  content_block: ContentBlock
}

export type StreamContentBlockDelta = {
  type: 'content_block_delta'
  index: number
  delta: TextDelta | InputJsonDelta
}

export type StreamContentBlockStop = {
  type: 'content_block_stop'
  index: number
}

export type StreamMessageStart = {
  type: 'message_start'
}

export type StreamMessageDelta = {
  type: 'message_delta'
}

export type StreamMessageStop = {
  type: 'message_stop'
}

export type StreamEventPayload =
  | StreamContentBlockStart
  | StreamContentBlockDelta
  | StreamContentBlockStop
  | StreamMessageStart
  | StreamMessageDelta
  | StreamMessageStop

// ─── SDK Message → IPC Message (discriminated union) ────────────────
// This is the single message type that crosses the IPC boundary.
// Main converts SDK messages into this shape; Preload forwards as-is;
// Renderer consumes via processIPCMessage reducer.

export type SystemInitPayload = {
  type: 'system'
  subtype: 'init'
  session_id: string
  model: string
  tools: string[]
}

export type SystemStatusPayload = {
  type: 'system'
  subtype: 'status'
  status: 'compacting' | 'requesting' | null
}

export type SystemCompactBoundaryPayload = {
  type: 'system'
  subtype: 'compact_boundary'
}

export type SystemPermissionDeniedPayload = {
  type: 'system'
  subtype: 'permission_denied'
  tool_use_id: string
  message: string
}

export type AssistantPayload = {
  type: 'assistant'
  uuid: string
  message: {
    content: ContentBlock[]
  }
  /** SDK-level error on this assistant message (authentication_failed, rate_limit, etc.) */
  error?: string
}

export type UserPayload = {
  type: 'user'
  uuid: string
  message: {
    content: ContentBlock[]
  }
}

export type ResultSuccessPayload = {
  type: 'result'
  subtype: 'success'
  session_id?: string
  usage: UsageInfo
  total_cost_usd: number
  duration_ms: number
}

export type ResultErrorPayload = {
  type: 'result'
  subtype: 'error'
  session_id?: string
  errors: string[]
  usage: UsageInfo
  total_cost_usd: number
  duration_ms: number
}

export type StreamEventPayloadIPC = {
  type: 'stream_event'
  uuid: string
  event: StreamEventPayload
}

export type SystemTaskNotificationPayload = {
  type: 'system'
  subtype: 'task_notification'
  task_id: string
  status: 'completed' | 'failed' | 'stopped'
  summary: string
}

export type AgentIPCMessage =
  | SystemInitPayload
  | SystemStatusPayload
  | SystemCompactBoundaryPayload
  | SystemPermissionDeniedPayload
  | SystemTaskNotificationPayload
  | AssistantPayload
  | UserPayload
  | ResultSuccessPayload
  | ResultErrorPayload
  | StreamEventPayloadIPC

export type AgentIPCMessageWithContext = AgentIPCMessage & { context: AgentContext; sessionId?: string }

// ─── Usage Info ──────────────────────────────────────────────────────

export type UsageInfo = {
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_creation_tokens: number
  server_tool_use?: Record<string, unknown>
}

// ─── Agent State Machine ─────────────────────────────────────────────

export type AgentState =
  | 'idle'
  | 'thinking'
  | 'running'
  | 'compacting'
  | 'waitingForUserInput'
  | 'error'

export type AgentEvent =
  | { type: 'SEND_MESSAGE' }
  | { type: 'FIRST_CONTENT' }
  | { type: 'STATUS_REQUESTING' }
  | { type: 'COMPACT_BOUNDARY' }
  | { type: 'ASK_USER_REQUEST' }
  | { type: 'ASK_USER_RESPONDED' }
  | { type: 'ASK_USER_TIMEOUT' }
  | { type: 'RESULT_SUCCESS' }
  | { type: 'RESULT_ERROR' }
  | { type: 'ABORT' }

export const AGENT_TRANSITIONS: Record<AgentState, Partial<Record<AgentEvent['type'], AgentState>>> = {
  idle:            { SEND_MESSAGE: 'thinking' },
  thinking:        { FIRST_CONTENT: 'running', STATUS_REQUESTING: 'thinking', COMPACT_BOUNDARY: 'compacting', RESULT_SUCCESS: 'idle', RESULT_ERROR: 'error', ABORT: 'idle' },
  running:         { STATUS_REQUESTING: 'thinking', COMPACT_BOUNDARY: 'compacting', ASK_USER_REQUEST: 'waitingForUserInput', RESULT_SUCCESS: 'idle', RESULT_ERROR: 'error', ABORT: 'idle' },
  compacting:      { FIRST_CONTENT: 'running', STATUS_REQUESTING: 'thinking', RESULT_SUCCESS: 'idle', RESULT_ERROR: 'error', ABORT: 'idle' },
  waitingForUserInput: { ASK_USER_RESPONDED: 'running', ASK_USER_TIMEOUT: 'error', ABORT: 'idle' },
  error:           { SEND_MESSAGE: 'thinking' },
}

// ─── Renderer Message Model ─────────────────────────────────────────

export type MessagePhase =
  | 'streaming'
  | 'tool_calling'
  | 'complete'
  | 'stopped'
  | 'error'

export type ToolCallState = {
  toolUseId: string
  toolName: string
  input: Record<string, unknown>
  inputJsonPartial?: string    // during streaming, before JSON completes
  result?: string
  status: 'pending' | 'running' | 'completed' | 'error'
}

export type ArtifactFileType = 'html' | 'md' | 'png' | 'svg' | 'json'

export type ArtifactData = {
  fileName: string
  fileType: ArtifactFileType
  filePath?: string
  content?: string
}

export type SkillMeta = {
  id: string
  name: string
  icon: string
  status: 'running' | 'completed' | 'error'
  outputFile?: string
  outputContent?: string
}

// ─── Discriminated Message Union ─────────────────────────────────────

interface MessageBase {
  id: string
  createdAt: number
}

export interface UserMessage extends MessageBase {
  kind: 'user'
  role: 'user'
  textContent: string
  skillMeta?: SkillMeta
}

export interface TextMessage extends MessageBase {
  kind: 'text'
  role: 'assistant'
  phase: MessagePhase
  textContent: string
  content: ContentBlock[]
  toolCalls: ToolCallState[]
  skillMeta?: SkillMeta
}

export interface ArtifactMessage extends MessageBase {
  kind: 'artifact'
  role: 'assistant'
  artifact: ArtifactData
}

export interface StatusMessage extends MessageBase {
  kind: 'status'
  role: 'system'
  phase: MessagePhase
  textContent: string
}

export interface StoppedMessage extends MessageBase {
  kind: 'stopped'
  role: 'assistant'
  phase: 'stopped'
  textContent: string
}

export type ConversationMessage =
  | UserMessage
  | TextMessage
  | ArtifactMessage
  | StatusMessage
  | StoppedMessage

// ─── Streaming Accumulator (store-internal) ─────────────────────────

export type StreamingAccumulator = {
  messageId: string
  text: string
  toolUseBlocks: Map<string, {
    name: string
    inputJson: string
  }>
  thinkingText: string
}

// ─── Skill Output State (unified capture layer) ─────────────────────

export type SkillOutputState = {
  skillId: string | null
  content: string
  isStreaming: boolean
  language: string
  context?: AgentContext
  sessionId?: string
}

// ─── Permission / AskUser ────────────────────────────────────────────

export type PermissionRequestIPC = {
  id: string
  toolName: string
  input: Record<string, unknown>
  description?: string
  context?: AgentContext
  sessionId?: string
}

export type AskUserQuestionOption = {
  label: string
  description?: string
  preview?: string
}

export type AskUserQuestionItem = {
  question: string
  header?: string
  options: AskUserQuestionOption[]
  multiSelect: boolean
}

export type AskUserRequestIPC = {
  id: string
  /** All questions from SDK (1-4). Use this for multi-question UI. */
  questions: AskUserQuestionItem[]
  /** Convenience: first question text (for backward compat) */
  question: string
  /** Convenience: first question header */
  header?: string
  /** Convenience: first question options */
  options: AskUserQuestionOption[]
  /** Convenience: first question multiSelect */
  multiSelect: boolean
  context?: AgentContext
  sessionId?: string
}

// ─── Session Info ────────────────────────────────────────────────────

export type SdkSessionInfo = {
  id: string
  title?: string
  createdAt?: number
  lastModified?: number
  messageCount?: number
  cwd?: string           // SDK directory this session was stored in
  workspacePath?: string // workspace directory this session belongs to
  context?: string       // AgentContext ('editor' | 'ask')
}

// ─── Paginated Messages Response ─────────────────────────────────────

export type PaginatedMessagesResponse = {
  messages: ConversationMessage[]
  total: number       // from SdkSessionInfo.messageCount
  offset: number
  limit: number
  hasMore: boolean
}

// ─── Graph / Knowledge Graph ────────────────────────────────────────

export type GraphNodeType = 'file' | 'memory' | 'entity'

export type GraphEdgeType = 'reference'

export type GraphNode = {
  id: string
  label: string
  type: GraphNodeType
  entityType?: string
}

export type GraphEdge = {
  source: string
  target: string
  label?: string
  type: GraphEdgeType
}

export type GraphData = {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

// ─── File Entry (workspace tree) ────────────────────────────────────

export type FileChangeEvent = {
  filePath: string
  changeType: 'add' | 'change' | 'unlink'
}

// ─── File Entry (workspace tree) ────────────────────────────────────

export type FileEntry = {
  name: string
  path: string
  isDirectory: boolean
  children?: FileEntry[]
}

// ─── Workspace Record (P0: workspace-centric architecture) ────────────

export interface WorkspaceRecord {
  id: string            // UUID, stable identity
  name: string          // display name (directory basename)
  path: string          // absolute filesystem path
  icon?: string         // emoji or icon key
  isFixed: boolean      // true for Knowledge Base, false for user workspaces
  createdAt: number
  lastOpenedAt: number
}

// ─── Session Record (app-owned metadata, persisted in electron-store) ──

export type SessionStatus = 'active' | 'idle' | 'archived'

export interface SessionRecord {
  id: string            // SDK session_id
  workspacePath: string // FK → WorkspaceRecord.path
  title?: string        // user or auto-generated title
  summary?: string      // first assistant response, truncated
  firstPrompt?: string  // first user message, truncated
  context: AgentContext // 'editor' | 'ask'
  status: SessionStatus
  tags?: string[]
  createdAt: number
  lastModified: number
  messageCount: number
  artifactCount: number
  legacyMigration?: boolean
}

// ─── Artifact Record (per-workspace sidecar: .vision/artifacts.json) ───

export type ArtifactCategory = 'file' | 'deliverable' | 'skill_output' | 'memory'

export interface ArtifactRecord {
  id: string            // UUID
  sessionId: string     // FK → SessionRecord.id
  workspacePath: string // FK → WorkspaceRecord.path (denormalized)
  fileName: string
  filePath: string      // absolute path
  relativePath: string  // relative to workspace root
  fileType: ArtifactFileType
  category: ArtifactCategory
  toolCallId?: string   // Write/Edit tool_use id
  skillId?: string      // which skill created this
  createdAt: number
  updatedAt: number
}

// ─── Artifact Index File (shape of .vision/artifacts.json) ─────────────

export interface ArtifactIndexFile {
  version: 1
  workspacePath: string
  updatedAt: number
  artifacts: ArtifactRecord[]
}

// ─── Session Digest (lightweight, for overview display) ────────────────

export interface SessionDigest {
  sessionId: string
  title: string
  firstPrompt: string       // first user message, max 80 chars
  assistantSummary: string  // first assistant text, max 150 chars
  createdAt: number
  lastModified: number
  messageCount: number
  artifactCount: number
  status: SessionStatus
  artifactFiles: Array<{ fileName: string; filePath: string; fileType: ArtifactFileType }>
}

// ─── Workspace Digest (aggregate overview data) ────────────────────────

export interface WorkspaceDigest {
  workspacePath: string
  workspaceName: string
  stats: {
    totalSessions: number
    totalArtifacts: number
    totalFiles: number
    lastActiveAt: number | null
  }
  recentSessions: SessionDigest[]
  recentFiles: Array<{ name: string; path: string }>
}

// ─── Tab Descriptor (supports fixed tabs + file tabs) ──────────────────

export interface FileTab {
  type: 'file'
  path: string
}

export interface FixedTab {
  type: 'fixed'
  id: string
}

export type TabDescriptor = FileTab | FixedTab

export const OVERVIEW_TAB_ID = 'workspace-overview'

// Tab type guards
export function isFileTab(t: TabDescriptor): t is FileTab { return t.type === 'file' }
export function isFixedTab(t: TabDescriptor): t is FixedTab { return t.type === 'fixed' }
export function isOverviewTab(t: TabDescriptor): boolean { return isFixedTab(t) && t.id === OVERVIEW_TAB_ID }
export function tabKey(t: TabDescriptor): string { return isFileTab(t) ? t.path : t.id }

// ─── Session Output (per-session file listing for overview) ──────────

export interface SessionOutputEntry {
  fileName: string
  filePath: string
  fileType: ArtifactFileType
  category: 'document' | 'skill_output' | 'other'
  source: string
  size?: number
  createdAt: number
}

export interface SessionOutputs {
  sessionId: string
  workspacePath: string
  files: SessionOutputEntry[]
}
