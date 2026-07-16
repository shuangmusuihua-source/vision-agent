import type {
  AgentIPCMessage,
  AgentIPCMessageWithContext,
  AgentContext,
  AgentApprovalMode,
  AgentNotificationEvent,
  AgentSessionEnvelope,
  SessionRoutedAskUserRequest,
  SessionRoutedPermissionRequest,
  SessionRoutedGenerationActivity,
  SdkSessionInfo,
  GraphNode,
  GraphEdge,
  ModelProfile,
  SessionOutputs,
  BuiltinSkillCatalogItem,
  CommunitySkillCatalogItem,
  CommunitySkillMutationResult,
  InlineRewriteRequest,
  InlineRewriteResponse,
  MemoryDocument,
  MemoryEntry,
} from '../../shared/types'
import type {
  MarkitdownFormat,
  MarkitdownRuntimeInstallResult,
  MarkitdownRuntimeStatus,
} from '../../shared/markitdown-runtime'
import type {
  OfficeCliRuntimeInstallResult,
  OfficeCliRuntimeStatus,
} from '../../shared/officecli-runtime'
import type {
  UpdateCheckResult,
  UpdateDownloadProgress,
  UpdateErrorPayload,
} from '../../shared/update-types'
import type {
  CronScheduleParseRequest,
  CronScheduleParseResponse,
  CronTask,
  CronTaskCompletedEvent,
  CronTaskRegistration,
  CronTaskTarget,
} from '../../shared/cron-types'
import type { IPCRequest, IPCResponse } from '../../shared/ipc-types'

// ─── API Interfaces ──────────────────────────────────────────────────

// ─── App Settings ────────────────────────────────────────────────────

interface AppSettings {
  profiles: ModelProfile[]
  activeProfileId: string | null
  authorizedDirectories: string[]
  fixedDirectories: string[]
  workspaces?: import('../../shared/types').WorkspaceRecord[]
  sessions?: import('../../shared/types').SessionRecord[]
  theme: 'light' | 'dark' | 'system'
}

// ─── Skill Definition ────────────────────────────────────────────────

interface SkillDefinition {
  id: string
  name: string
  description: string
  icon: string
  promptTemplate: string
  argumentHint?: string
  outputMode?: 'skill-output' | 'write'
  hideInSlashMenu?: boolean
  enabled?: boolean
}

// ─── Search Result ──────────────────────────────────────────────────

interface SearchResult {
  filePath: string
  fileName: string
  workspaceName: string
  line: number
  content: string
}

// ─── API Interfaces ──────────────────────────────────────────────────

interface WorkspaceApi {
  readFile: (filePath: string) => Promise<{ success: boolean; content?: string; error?: string }>
  writeFile: (filePath: string, content: string) => Promise<{ success: boolean; error?: string }>
  savePastedImage: (
    request: IPCRequest<'workspace:savePastedImage'>,
  ) => Promise<IPCResponse<'workspace:savePastedImage'>>
  readImageAsset: (
    request: IPCRequest<'workspace:readImageAsset'>,
  ) => Promise<IPCResponse<'workspace:readImageAsset'>>
  addToKnowledge: (sourcePath: string, sessionId?: string) => Promise<{
    success: boolean
    filePath?: string
    fileName?: string
    alreadyExists?: boolean
    updated?: boolean
    error?: string
  }>
  createWorkspace: (name: string) => Promise<string | null>
  deleteWorkspace: (dirPath: string) => Promise<{ success: boolean; error?: string }>
  knowledgeDir: () => Promise<string>
  selectFiles: () => Promise<{ canceled: boolean; filePaths: string[]; attachmentGrantId?: string }>
  listMarkdownFiles: (dirPath: string) => Promise<Array<{ label: string; path: string }>>
  openInBrowser: (filePath: string) => Promise<void>
  openExternalUrl: (url: string) => Promise<{ success: boolean }>
  saveArtifact: (options: { fileName: string; content: string; defaultPath?: string }) => Promise<{ success: boolean; filePath?: string }>
  previewArtifact: (options: { fileName: string; content: string }) => Promise<{ success: boolean; filePath?: string }>
}

interface EditorApi {
  prepareRewrite: (request: Pick<InlineRewriteRequest, 'requestId' | 'filePath'>) => Promise<{ prepared: boolean }>
  rewriteSelection: (request: InlineRewriteRequest) => Promise<InlineRewriteResponse>
  cancelRewrite: (requestId: string) => Promise<{ cancelled: boolean }>
}

interface SettingsApi {
  get: () => Promise<AppSettings>
  addProfile: (profile: ModelProfile) => Promise<{ success: boolean }>
  updateProfile: (id: string, updates: Partial<ModelProfile>) => Promise<{ success: boolean }>
  removeProfile: (id: string) => Promise<{ success: boolean }>
  setActiveProfile: (id: string) => Promise<{ success: boolean }>
  removeDirectory: (dir: string) => Promise<{ success: boolean }>
  reorderDirectories: (paths: string[]) => Promise<{ success: boolean }>
  setTheme: (theme: 'light' | 'dark' | 'system') => Promise<{ success: boolean }>
  onChanged: (callback: (settings: Record<string, unknown>) => void) => () => void
  testConnection: (options: { baseUrl: string; apiKey: string; model: string }) => Promise<{ success: boolean; message: string }>
}

interface AgentApi {
  sendMessage: (prompt: string, sessionId?: string, activeFilePath?: string, skillId?: string, context?: AgentContext, workspacePath?: string, title?: string, clientSessionKey?: string, approvalMode?: AgentApprovalMode) => Promise<{ started: boolean }>
  respondPermission: (requestId: string, behavior: 'allow' | 'deny', options?: { updatedPermissions?: Array<Record<string, unknown>>; decisionClassification?: 'user_temporary' | 'user_permanent' | 'user_reject' }) => Promise<{ success: boolean }>
  respondAskUser: (requestId: string, answers: Record<string, string>) => Promise<{ success: boolean }>
  listSdkSessions: (workspaceCwd?: string) => Promise<SdkSessionInfo[]>
  loadSessionMessagesPaginated: (sessionId: string, limit: number, offset: number) => Promise<{ messages: AgentIPCMessage[]; offset: number; limit: number; hasMore: boolean }>
  renameSession: (sessionId: string, title: string) => Promise<{ success: boolean }>
  updateSessionRecord: (
    sessionId: string,
    patch: IPCRequest<'agent:updateSessionRecord'>['patch'],
  ) => Promise<{ success: boolean; error?: string }>
  abort: (contextOrSessionId?: string) => Promise<{ success: boolean }>
  setPermissionMode: (queryKey: string, mode: AgentApprovalMode) => Promise<{ success: boolean; error?: string }>
  selectFolder: () => Promise<{ canceled: boolean; filePaths: string[] }>
  getSessionOutputs: (sessionId: string) => Promise<SessionOutputs | null>
  revealSessionOutput: (sessionId: string, filePath: string) => Promise<{ success: boolean; error?: string }>
  openSessionOutput: (sessionId: string, filePath: string) => Promise<{ success: boolean; error?: string }>
  deleteSessionOutput: (sessionId: string, filePath: string) => Promise<{ success: boolean; error?: string }>
  deleteSession: (sessionId: string) => Promise<{ success: boolean }>
  removeSessionRecord: (sessionId: string) => Promise<{ success: boolean }>

  // Unified event channel
  onEvent: (callback: (msg: AgentIPCMessageWithContext) => void) => () => void

  // Lifecycle channels
  onSessionCreated: (callback: (data: AgentSessionEnvelope) => void) => () => void
  onSessionFilesChanged: (callback: (data: AgentSessionEnvelope) => void) => () => void
  onPermissionRequest: (callback: (data: SessionRoutedPermissionRequest) => void) => () => void
  onAskUser: (callback: (data: SessionRoutedAskUserRequest) => void) => () => void
  onAskUserTimeout: (callback: (data: { requestId: string } & AgentSessionEnvelope) => void) => () => void
  onPermissionTimeout: (callback: (data: { requestId: string } & AgentSessionEnvelope) => void) => () => void
  onNotification: (callback: (data: AgentNotificationEvent) => void) => () => void
  onGenerationActivity: (callback: (state: SessionRoutedGenerationActivity) => void) => () => void
}

interface GraphApi {
  getData: () => Promise<{ nodes: GraphNode[]; edges: GraphEdge[]; changeVersion?: number }>
  acknowledgeChanges: (version: number) => Promise<{ count: number; files: string[]; version: number }>
  onFilesChanged: (callback: (data: { count: number; files: string[]; version: number }) => void) => () => void
}

interface CronApi {
  selectDirectory: () => Promise<{ canceled: boolean; filePaths: string[] }>
  register: (request: CronTaskRegistration) => Promise<{ success: boolean; task?: CronTask; error?: string }>
  list: () => Promise<CronTask[]>
  resolveSchedule: (request: CronScheduleParseRequest) => Promise<CronScheduleParseResponse>
  remove: (taskId: string) => Promise<boolean>
  execute: (taskId: string) => Promise<{ success: boolean; result?: string; error?: string }>
  stop: (taskId: string) => Promise<{ success: boolean; error?: string }>
  setStatus: (taskId: string, status: CronTask['status']) => Promise<{ success: boolean; task?: CronTask; error?: string }>
  onTaskCompleted: (callback: (data: CronTaskCompletedEvent) => void) => () => void
}

interface SkillsApi {
  list: () => Promise<SkillDefinition[]>
  toggle: (skillId: string, enabled: boolean) => Promise<string[]>
  builtins: () => Promise<BuiltinSkillCatalogItem[]>
  catalog: () => Promise<CommunitySkillCatalogItem[]>
  install: (skillId: string) => Promise<CommunitySkillMutationResult>
  update: (skillId: string) => Promise<CommunitySkillMutationResult>
  uninstall: (skillId: string) => Promise<CommunitySkillMutationResult>
  onChanged: (callback: (change: { skillId: string; reason: 'installed' | 'updated' | 'uninstalled' | 'toggled' }) => void) => () => void
}

interface AttachmentsApi {
  runtimeStatus: (formats?: MarkitdownFormat[]) => Promise<MarkitdownRuntimeStatus>
  installRuntime: () => Promise<MarkitdownRuntimeInstallResult>
}

interface OfficeApi {
  runtimeStatus: () => Promise<OfficeCliRuntimeStatus>
  installRuntime: () => Promise<OfficeCliRuntimeInstallResult>
}

interface SearchApi {
  query: (keyword: string) => Promise<SearchResult[]>
}

interface MenuApi {
  onAction: (callback: (action: string) => void) => () => void
}

interface UpdateApi {
  download: () => Promise<void>
  install: () => Promise<void>
  openLatestRelease: () => Promise<void>
  checkForUpdates: () => Promise<UpdateCheckResult>
  onAvailable: (callback: (info: { version: string }) => void) => () => void
  onDownloaded: (callback: () => void) => () => void
  onDownloadProgress: (callback: (progress: UpdateDownloadProgress) => void) => () => void
  onError: (callback: (error: UpdateErrorPayload) => void) => () => void
}

// ─── Window API ──────────────────────────────────────────────────────

interface WindowApi {
  getVersion: () => Promise<string>
  workspace: WorkspaceApi
  editor: EditorApi
  settings: SettingsApi
  agent: AgentApi
  memory: MemoryApi
  graph: GraphApi
  cron: CronApi
  skills: SkillsApi
  attachments: AttachmentsApi
  office: OfficeApi
  search: SearchApi
  menu: MenuApi
  update: UpdateApi
  onMainError: (callback: (error: { type: string; message: string }) => void) => () => void
}

interface MemoryApi {
  list: () => Promise<MemoryEntry[]>
  read: (filePath: string) => Promise<{ success: boolean; document?: MemoryDocument; error?: string }>
  update: (filePath: string, content: string) => Promise<{ success: boolean; document?: MemoryDocument; error?: string }>
  delete: (filePath: string) => Promise<{ success: boolean; error?: string }>
}

declare global {
  interface Window {
    api: WindowApi
  }
}

export type {
  WindowApi,
  WorkspaceApi,
  EditorApi,
  SettingsApi,
  AgentApi,
  MemoryApi,
  GraphApi,
  CronApi,
  SkillsApi,
  AttachmentsApi,
  OfficeApi,
  SearchApi,
  MenuApi,
  UpdateApi,
  ModelProfile,
  AppSettings,
  SkillDefinition,
  SearchResult,
  GraphNode,
  GraphEdge,
  MemoryDocument,
  MemoryEntry,
  CronTask,
  CronTaskRegistration,
  CronScheduleParseRequest,
  CronScheduleParseResponse,
  CronTaskCompletedEvent,
  CronTaskTarget,
}

export type { UpdateCheckResult }
