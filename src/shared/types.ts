// Shared types for Agent Panel — used by Main, Preload, and Renderer
// All discriminated unions defined here; no `Record<string, unknown>` downstream.

import type { AttachmentConversionDisplayStatus } from './file-attachments'

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

// ─── Curated community Skills ────────────────────────────────────────

export interface CommunitySkillAudit {
  name: string
  status: 'passed' | 'reviewed' | 'warning' | 'failed'
}

export interface BuiltinSkillCatalogItem {
  id: string
  name: string
  description: string
  icon: string
  enabled: boolean
}

export interface CommunitySkillCatalogItem {
  id: string
  name: string
  author: string
  category: string
  summary: string
  description: string
  tags: string[]
  sourcePageUrl: string
  repositoryUrl: string
  icon: string
  audits: CommunitySkillAudit[]
  installed: boolean
  enabled: boolean
  updateAvailable: boolean
  installedAt?: string
  updatedAt?: string
}

export interface CommunitySkillMutationResult {
  success: boolean
  error?: string
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
  ttft_ms?: number
}

export type StreamMessageDelta = {
  type: 'message_delta'
  stop_reason?: string
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
  skills: string[]
  slash_commands: string[]
}

export type SystemStatusPayload = {
  type: 'system'
  subtype: 'status'
  status: 'compacting' | 'requesting' | null
  compact_result?: 'success' | 'failed'
  compact_error?: string
}

export type SystemCompactBoundaryPayload = {
  type: 'system'
  subtype: 'compact_boundary'
  compact_metadata?: {
    trigger: 'manual' | 'auto'
    pre_tokens: number
    post_tokens?: number
    duration_ms?: number
  }
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
  // SDK-injected skill/context messages (not user-typed)
  isMeta?: true
  message: {
    // SDK compaction produces a plain string (continuation summary) instead
    // of an array of content blocks for continuation user messages.
    content: ContentBlock[] | string
  }
}

export type ResultSuccessPayload = {
  type: 'result'
  subtype: 'success'
  session_id?: string
  usage: UsageInfo
  total_cost_usd: number
  duration_ms: number
  stop_reason?: string
  num_turns?: number
  result?: string
}

export type ResultErrorPayload = {
  type: 'result'
  subtype: 'error_during_execution' | 'error_max_turns' | 'error_max_budget_usd' | 'error_max_structured_output_retries'
  session_id?: string
  errors: string[]
  usage: UsageInfo
  total_cost_usd: number
  duration_ms: number
  stop_reason?: string
  num_turns?: number
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

export type RateLimitPayload = {
  type: 'rate_limit_event'
  rate_limit_info?: {
    status?: 'allowed' | 'allowed_warning' | 'rejected'
    resets_at?: string
    limit?: number
    remaining?: number
  }
}

export type PromptSuggestionPayload = {
  type: 'prompt_suggestion'
  suggestions: string[]
}

export type AgentIPCMessage =
  | SystemInitPayload
  | SystemStatusPayload
  | SystemCompactBoundaryPayload
  | SystemPermissionDeniedPayload
  | SystemTaskNotificationPayload
  | RateLimitPayload
  | PromptSuggestionPayload
  | AssistantPayload
  | UserPayload
  | ResultSuccessPayload
  | ResultErrorPayload
  | StreamEventPayloadIPC

export type AgentSessionEnvelope = {
  context: AgentContext
  /** App-owned stable session key used for renderer routing. */
  sessionId: string
  /** Explicit alias for the app-owned stable session key. */
  clientSessionKey: string
  /** Claude SDK session_id used for resume/history/delete operations. */
  sdkSessionId?: string
  /** Workspace/app directory that owns this session. */
  workspacePath: string
}

export type SessionRoutedPayload<T extends Record<string, unknown>> = T & AgentSessionEnvelope

export type SessionRoutedAgentIPCMessage = AgentIPCMessage & AgentSessionEnvelope
export type SessionRoutedPermissionRequest = PermissionRequestIPC & AgentSessionEnvelope
export type SessionRoutedAskUserRequest = AskUserRequestIPC & AgentSessionEnvelope
export type SessionRoutedRequestTimeout = { requestId: string } & AgentSessionEnvelope
export type SessionRoutedNotification = { type: string; message: string; title: string } & AgentSessionEnvelope
export type SessionRoutedGenerationActivity = GenerationActivity & AgentSessionEnvelope
export type GeneralAgentNotification = {
  type: string
  message: string
  title: string
  workspaceCwd?: string
}
export type AgentNotificationEvent =
  | GeneralAgentNotification
  | (SessionRoutedNotification & { workspaceCwd?: string })

export type AgentIPCMessageWithContext = SessionRoutedAgentIPCMessage

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

// ─── Agent Task Tracking (TaskCreate / TaskUpdate from SDK) ────────

export type TodoTaskStatus = 'pending' | 'in_progress' | 'completed'

export type TodoTask = {
  taskId: string
  subject: string
  description?: string
  status: TodoTaskStatus
  createdAt: number
}

export type TodoTaskList = {
  tasks: TodoTask[]
  totalCount: number
}

export type ToolCallState = {
  toolUseId: string
  toolName: string
  input: Record<string, unknown>
  inputJsonPartial?: string    // during streaming, before JSON completes
  result?: string
  status: 'pending' | 'running' | 'completed' | 'error'
}

export type ArtifactFileType =
  | 'html'
  | 'md'
  | 'png'
  | 'svg'
  | 'json'
  | 'pdf'
  | 'docx'
  | 'pptx'
  | 'xlsx'
  | 'other'

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
  attachmentConversions?: AttachmentConversionDisplayStatus[]
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

// ─── Live Generation Activity ───────────────────────────────────────

export type GenerationActivityPhase =
  | 'preparing'
  | 'generating'
  | 'finalizing'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type GenerationActivity = {
  /** Stable within one streamed content block. */
  activityId: string
  skillId: string | null
  phase: GenerationActivityPhase
  source: 'tool-input' | 'skill-output'
  toolName?: string
  label: string
  content: string
  language: string
}

// ─── Permission / AskUser ────────────────────────────────────────────

// Re-export SDK permission types for use across IPC boundary
export type PermissionBehavior = 'allow' | 'deny' | 'ask'

export type PermissionRuleValue = {
  toolName: string
  ruleContent?: string
}

export type PermissionUpdateDestination = 'userSettings' | 'projectSettings' | 'localSettings' | 'session' | 'cliArg'

export type PermissionUpdate =
  | { type: 'addRules'; rules: PermissionRuleValue[]; behavior: PermissionBehavior; destination: PermissionUpdateDestination }
  | { type: 'replaceRules'; rules: PermissionRuleValue[]; behavior: PermissionBehavior; destination: PermissionUpdateDestination }
  | { type: 'removeRules'; rules: PermissionRuleValue[]; behavior: PermissionBehavior; destination: PermissionUpdateDestination }
  | { type: 'setMode'; mode: string; destination: PermissionUpdateDestination }
  | { type: 'addDirectories'; directories: string[]; destination: PermissionUpdateDestination }
  | { type: 'removeDirectories'; directories: string[]; destination: PermissionUpdateDestination }

export type PermissionDecisionClassification = 'user_temporary' | 'user_permanent' | 'user_reject'

export type PermissionRequestIPC = {
  id: string
  toolName: string
  input: Record<string, unknown>
  description?: string
  context?: AgentContext
  /** App-owned stable session key used for renderer routing. */
  sessionId?: string
  /** Claude SDK session_id, when already materialized. */
  sdkSessionId?: string
  clientSessionKey?: string
  workspacePath?: string
  /** SDK-provided display title (e.g. "Claude wants to read foo.txt") */
  title?: string
  /** Short noun phrase for the tool action (e.g. "Read file") */
  displayName?: string
  /** SDK-provided permission suggestions for "always allow" */
  suggestions?: PermissionUpdate[]
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
  /** App-owned stable session key used for renderer routing. */
  sessionId?: string
  /** Claude SDK session_id, when already materialized. */
  sdkSessionId?: string
  clientSessionKey?: string
  workspacePath?: string
}

// ─── Session Info ────────────────────────────────────────────────────

export type SdkSessionInfo = {
  /** App-owned stable session key used by the renderer/sidebar. */
  id: string
  /** Claude SDK session_id used for resume/history/delete operations. */
  sdkSessionId?: string
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
  /** File-index version represented by this graph snapshot. */
  changeVersion?: number
}

// ─── File Entry (workspace tree) ────────────────────────────────────

export type FileChangeEvent = {
  filePath: string
  changeType: 'add' | 'change' | 'unlink'
}

// ─── File Entry (workspace tree) ────────────────────────────────────

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

export type SessionStatus = 'active' | 'idle' | 'archived' | 'empty'

export interface SessionRecord {
  id: string            // App-owned stable session key
  sdkSessionId?: string // Claude SDK session_id once materialized
  workspacePath: string // FK → WorkspaceRecord.path
  /** Isolated SDK cwd for sessions created with the session-files model. */
  workingDirectory?: string
  title?: string        // user or auto-generated title
  summary?: string      // first assistant response, truncated
  firstPrompt?: string  // first user message, truncated
  context: AgentContext // 'editor' | 'ask'
  status: SessionStatus
  tags?: string[]
  createdAt: number
  lastModified: number
  messageCount: number
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
  availability: 'available' | 'missing'
  size?: number
  createdAt: number
}

export interface SessionOutputs {
  sessionId: string
  workspacePath: string
  files: SessionOutputEntry[]
}
