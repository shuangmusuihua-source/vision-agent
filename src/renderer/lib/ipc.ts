import type {
  AgentIPCMessage,
  AgentIPCMessageWithContext,
  AgentContext,
  AgentSessionEnvelope,
  AskUserRequestIPC,
  PermissionRequestIPC,
  ContentBlock,
  SdkSessionInfo,
  UsageInfo,
  AskUserQuestionOption,
  GraphNode,
  GraphEdge,
  FileEntry,
  ModelProfile,
  SessionOutputs,
  SkillOutputState,
} from '../../shared/types'

// ─── API Interfaces ──────────────────────────────────────────────────

// ─── App Settings ────────────────────────────────────────────────────

interface AppSettings {
  profiles: ModelProfile[]
  activeProfileId: string | null
  authorizedDirectories: string[]
  fixedDirectories: string[]
  workspaces?: import('../../shared/types').WorkspaceRecord[]
  sessions?: import('../../shared/types').SessionRecord[]
  storeVersion?: number
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
  line: number
  content: string
}

// ─── Cron Task ──────────────────────────────────────────────────────

interface CronTask {
  id: string
  name: string
  cronExpression: string
  prompt: string
  createdAt: number
  lastRunAt: number | null
  lastResult: string | null
  status: 'active' | 'paused'
}

// ─── Notification History ────────────────────────────────────────────

interface NotificationHistoryItem {
  id: string
  groupId: string
  title: string
  body: string
}

// ─── API Interfaces ──────────────────────────────────────────────────

interface WorkspaceApi {
  listFiles: (dirPath: string) => Promise<FileEntry[]>
  readFile: (filePath: string) => Promise<{ success: boolean; content?: string; error?: string }>
  writeFile: (filePath: string, content: string) => Promise<{ success: boolean; error?: string }>
  openDirectoryDialog: () => Promise<string | null>
  newDirectoryDialog: () => Promise<string | null>
  createWorkspace: (name: string) => Promise<string | null>
  createFile: (dirPath: string, fileName: string) => Promise<{ success: boolean; path?: string; error?: string }>
  deleteFile: (filePath: string) => Promise<{ success: boolean; error?: string }>
  renameFile: (filePath: string, newName: string) => Promise<{ success: boolean; newPath?: string; error?: string }>
  moveFile: (sourcePath: string, targetDir: string) => Promise<{ success: boolean; newPath?: string; error?: string }>
  deleteWorkspace: (dirPath: string) => Promise<{ success: boolean; error?: string }>
  knowledgeDir: () => Promise<string>
  createDir: (parentPath: string, dirName: string) => Promise<{ success: boolean; path?: string; error?: string }>
  renameEntry: (oldPath: string, newName: string) => Promise<{ success: boolean; path?: string; error?: string }>
  deleteDir: (dirPath: string) => Promise<{ success: boolean; error?: string }>
  selectFiles: () => Promise<{ canceled: boolean; filePaths: string[] }>
  listMarkdownFiles: (dirPath: string) => Promise<Array<{ label: string; path: string }>>
  openInBrowser: (filePath: string) => Promise<void>
  saveArtifact: (options: { fileName: string; content: string; defaultPath?: string }) => Promise<{ success: boolean; filePath?: string }>
  previewArtifact: (options: { fileName: string; content: string }) => Promise<{ success: boolean; filePath?: string }>
  getSessionOverview: (workspaceDir: string) => Promise<import('../../shared/types').WorkspaceDigest | null>
}

interface SettingsApi {
  get: () => Promise<AppSettings>
  addProfile: (profile: ModelProfile) => Promise<{ success: boolean }>
  updateProfile: (id: string, updates: Partial<ModelProfile>) => Promise<{ success: boolean }>
  removeProfile: (id: string) => Promise<{ success: boolean }>
  setActiveProfile: (id: string) => Promise<{ success: boolean }>
  addDirectory: (dir: string) => Promise<{ success: boolean }>
  removeDirectory: (dir: string) => Promise<{ success: boolean }>
  reorderDirectories: (paths: string[]) => Promise<{ success: boolean }>
  getTheme: () => Promise<'light' | 'dark' | 'system'>
  setTheme: (theme: 'light' | 'dark' | 'system') => Promise<{ success: boolean }>
  onChanged: (callback: (settings: Record<string, unknown>) => void) => () => void
  testConnection: (options: { baseUrl: string; apiKey: string; model: string }) => Promise<{ success: boolean; message: string }>
}

interface AgentApi {
  sendMessage: (prompt: string, sessionId?: string, activeFilePath?: string, skillId?: string, context?: AgentContext, workspacePath?: string, title?: string, clientSessionKey?: string) => Promise<{ started: boolean }>
  respondPermission: (requestId: string, behavior: 'allow' | 'deny', options?: { updatedPermissions?: Array<Record<string, unknown>>; decisionClassification?: 'user_temporary' | 'user_permanent' | 'user_reject' }) => Promise<{ success: boolean }>
  respondAskUser: (requestId: string, answers: Record<string, string>) => Promise<{ success: boolean }>
  listSdkSessions: (workspaceCwd?: string) => Promise<SdkSessionInfo[]>
  loadSessionMessages: (sessionId: string) => Promise<AgentIPCMessage[]>
  loadSessionMessagesPaginated: (sessionId: string, limit: number, offset: number) => Promise<{ messages: AgentIPCMessage[]; offset: number; limit: number; hasMore: boolean }>
  renameSession: (sessionId: string, title: string) => Promise<void>
	  updateSessionRecord: (sessionId: string, patch: Record<string, unknown>) => Promise<{ success: boolean }>
  abort: (contextOrSessionId?: string) => Promise<{ success: boolean }>
  setPermissionMode: (context: AgentContext, mode: string) => Promise<{ success: boolean }>
  forkSession: (sessionId: string, options?: { upToMessageId?: string; title?: string }) => Promise<{ success: boolean; sessionId?: string; error?: string }>
  selectFolder: () => Promise<Electron.OpenDialogReturnValue>
  getSessionOutputs: (sessionId: string) => Promise<SessionOutputs | null>
  deleteSession: (sessionId: string) => Promise<{ success: boolean }>
  removeSessionRecord: (sessionId: string) => Promise<void>

  // Unified event channel
  onEvent: (callback: (msg: AgentIPCMessageWithContext) => void) => () => void

  // Lifecycle channels
  onSessionCreated: (callback: (data: AgentSessionEnvelope) => void) => () => void
  onPermissionRequest: (callback: (data: PermissionRequestIPC) => void) => () => void
  onAskUser: (callback: (data: AskUserRequestIPC) => void) => () => void
  onAskUserTimeout: (callback: (data: { requestId: string } & AgentSessionEnvelope) => void) => () => void
  onPermissionTimeout: (callback: (data: { requestId: string } & AgentSessionEnvelope) => void) => () => void
  onNotification: (callback: (data: { type: string; message: string; title: string } & Partial<AgentSessionEnvelope>) => void) => () => void
  onSkillOutput: (callback: (state: SkillOutputState) => void) => () => void
}

interface GraphApi {
  getData: () => Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }>
  onFilesChanged: (callback: (data: { count: number; files: string[] }) => void) => () => void
}

interface CronApi {
  register: (cronExpression: string, prompt: string, name?: string) => Promise<{ success: boolean; task?: CronTask; error?: string }>
  list: () => Promise<CronTask[]>
  remove: (taskId: string) => Promise<boolean>
  execute: (taskId: string) => Promise<{ success: boolean; result?: string; error?: string }>
  onTaskCompleted: (callback: (data: unknown) => void) => () => void
}

interface SkillsApi {
  list: () => Promise<SkillDefinition[]>
  toggle: (skillId: string, enabled: boolean) => Promise<string[]>
  getEnabled: () => Promise<string[]>
}

interface SearchApi {
  query: (keyword: string) => Promise<SearchResult[]>
}

interface MenuApi {
  onAction: (callback: (action: string) => void) => () => void
}

interface NotificationApi {
  getHistory: () => Promise<NotificationHistoryItem[]>
}

interface UpdateApi {
  download: () => Promise<void>
  install: () => Promise<void>
  checkForUpdates: () => Promise<void>
  onAvailable: (callback: (info: { version: string }) => void) => () => void
  onDownloaded: (callback: () => void) => () => void
  onError: (callback: (error: { message: string }) => void) => () => void
}

// ─── Window API ──────────────────────────────────────────────────────

interface WindowApi {
  ping: () => Promise<string>
  workspace: WorkspaceApi
  settings: SettingsApi
  agent: AgentApi
  memory: MemoryApi
  graph: GraphApi
  cron: CronApi
  skills: SkillsApi
  search: SearchApi
  menu: MenuApi
  notification: NotificationApi
  update: UpdateApi
  onMainError: (callback: (error: { type: string; message: string }) => void) => () => void
}

interface MemoryApi {
  list: (workspacePath?: string) => Promise<Array<{ name: string; path: string }>>
  read: (filePath: string) => Promise<{ success: boolean; content?: string; error?: string }>
  write: (filePath: string, content: string) => Promise<{ success: boolean; error?: string }>
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
  SettingsApi,
  AgentApi,
  MemoryApi,
  GraphApi,
  CronApi,
  SkillsApi,
  SearchApi,
  MenuApi,
  NotificationApi,
  UpdateApi,
  NotificationHistoryItem,
  FileEntry,
  ModelProfile,
  AppSettings,
  SkillDefinition,
  SearchResult,
  GraphNode,
  GraphEdge,
  CronTask,
}
