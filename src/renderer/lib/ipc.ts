import type {
  AgentIPCMessage,
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
} from '../../shared/types'

// ─── API Interfaces ──────────────────────────────────────────────────

// ─── App Settings ────────────────────────────────────────────────────

interface AppSettings {
  profiles: ModelProfile[]
  activeProfileId: string | null
  authorizedDirectories: string[]
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
  listMarkdownFiles: (dirPath: string) => Promise<Array<{ label: string; path: string }>>
  openInBrowser: (filePath: string) => Promise<void>
  saveArtifact: (options: { fileName: string; content: string; defaultPath?: string }) => Promise<{ success: boolean; filePath?: string }>
  previewArtifact: (options: { fileName: string; content: string }) => Promise<{ success: boolean; filePath?: string }>
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
  sendMessage: (prompt: string, sessionId?: string, activeFilePath?: string) => Promise<{ started: boolean }>
  respondPermission: (requestId: string, behavior: 'allow' | 'deny') => Promise<{ success: boolean }>
  respondAskUser: (requestId: string, answer: string) => Promise<{ success: boolean }>
  listSdkSessions: () => Promise<SdkSessionInfo[]>
  loadSessionMessages: (sessionId: string) => Promise<AgentIPCMessage[]>
  abort: () => Promise<{ success: boolean }>

  // Unified event channel
  onEvent: (callback: (msg: AgentIPCMessage) => void) => () => void

  // Lifecycle channels
  onSessionCreated: (callback: (sessionId: string) => void) => () => void
  onPermissionRequest: (callback: (request: PermissionRequestIPC) => void) => () => void
  onAskUser: (callback: (request: AskUserRequestIPC) => void) => () => void
  onAskUserTimeout: (callback: (data: { requestId: string }) => void) => () => void
  onNotification: (callback: (data: { type: string; message: string; title: string }) => void) => () => void
}

interface GraphApi {
  getData: () => Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }>
  extractSemantic: () => Promise<{ success: boolean; error?: string; skipped?: boolean; message?: string; data?: { nodes: GraphNode[]; edges: GraphEdge[] } }>
  onSemanticProgress: (callback: (data: { phase: string; progress: number }) => void) => () => void
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
}

interface MemoryApi {
  list: () => Promise<Array<{ name: string; path: string }>>
  read: (filePath: string) => Promise<{ success: boolean; content?: string; error?: string }>
  write: (filePath: string, content: string) => Promise<{ success: boolean; error?: string }>
  delete: (filePath: string) => Promise<{ success: boolean; error?: string }>
}

interface SessionInfo {
  id: string
  createdAt: number
  messageCount: number
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
  NotificationHistoryItem,
  FileEntry,
  ModelProfile,
  AppSettings,
  SessionInfo,
  SkillDefinition,
  SearchResult,
  GraphNode,
  GraphEdge,
  CronTask,
}