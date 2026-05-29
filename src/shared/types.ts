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
  usage: UsageInfo
  total_cost_usd: number
  duration_ms: number
}

export type ResultErrorPayload = {
  type: 'result'
  subtype: 'error'
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

export type AgentIPCMessage =
  | SystemInitPayload
  | SystemStatusPayload
  | SystemCompactBoundaryPayload
  | SystemPermissionDeniedPayload
  | AssistantPayload
  | UserPayload
  | ResultSuccessPayload
  | ResultErrorPayload
  | StreamEventPayloadIPC

export type AgentIPCMessageWithContext = AgentIPCMessage & { context: AgentContext }

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
  thinking:        { FIRST_CONTENT: 'running', STATUS_REQUESTING: 'thinking', COMPACT_BOUNDARY: 'compacting', RESULT_ERROR: 'error', ABORT: 'idle' },
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

export type ConversationMessage = {
  id: string
  role: 'user' | 'assistant' | 'system'
  phase: MessagePhase
  textContent: string
  content: ContentBlock[]
  toolCalls: ToolCallState[]
  artifact?: ArtifactData
  skillMeta?: SkillMeta
  createdAt: number
}

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
}

// ─── Permission / AskUser ────────────────────────────────────────────

export type PermissionRequestIPC = {
  id: string
  toolName: string
  input: Record<string, unknown>
  description?: string
  context?: AgentContext
}

export type AskUserQuestionOption = {
  label: string
  description?: string
  preview?: string
}

export type AskUserRequestIPC = {
  id: string
  question: string
  header?: string
  options: AskUserQuestionOption[]
  multiSelect: boolean
  context?: AgentContext
}

// ─── Session Info ────────────────────────────────────────────────────

export type SdkSessionInfo = {
  id: string
  title?: string
  createdAt?: number
  lastModified?: number
  messageCount?: number
}

// ─── Graph / Knowledge Graph ────────────────────────────────────────

export type GraphNodeType = 'file' | 'memory' | 'entity'

export type GraphEdgeType = 'reference' | 'semantic'

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

export type GraphExtractionState =
  | 'idle'
  | 'indexing'
  | 'extracting'
  | 'merging'
  | 'complete'
  | 'error'

export type GraphExtractionProgress = {
  phase: string
  progress: number
  currentBatch?: number
  totalBatches?: number
}

export type FilterMode = 'all' | 'reference' | 'semantic'

export type GraphExtractionEvent =
  | { type: 'EXTRACT_START' }
  | { type: 'INDEX_DONE'; changedFiles: string[] }
  | { type: 'NO_CHANGES' }
  | { type: 'BATCH_PROGRESS'; currentBatch: number; totalBatches: number }
  | { type: 'ALL_BATCHES_DONE' }
  | { type: 'MERGE_DONE' }
  | { type: 'EXTRACT_ERROR'; error: string }
  | { type: 'ABORT' }
  | { type: 'AUTO_RESET' }

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
