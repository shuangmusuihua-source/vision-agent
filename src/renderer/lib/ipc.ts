interface FileEntry {
  name: string
  path: string
  isDirectory: boolean
  children?: FileEntry[]
}

interface ModelProfile {
  id: string
  name: string
  apiKey: string
  apiProvider: string
  baseUrl: string
  model: string
}

interface AppSettings {
  profiles: ModelProfile[]
  activeProfileId: string | null
  authorizedDirectories: string[]
  theme: 'light' | 'dark' | 'system'
}

interface WorkspaceApi {
  listFiles: (dirPath: string) => Promise<FileEntry[]>
  readFile: (filePath: string) => Promise<{ success: boolean; content?: string; error?: string }>
  writeFile: (filePath: string, content: string) => Promise<{ success: boolean; error?: string }>
  openDirectoryDialog: () => Promise<string | null>
  newDirectoryDialog: () => Promise<string | null>
  createWorkspace: (name: string) => Promise<string | null>
  createFile: (dirPath: string, fileName: string) => Promise<{ success: boolean; path?: string; error?: string }>
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
  getTheme: () => Promise<'light' | 'dark' | 'system'>
  setTheme: (theme: 'light' | 'dark' | 'system') => Promise<{ success: boolean }>
  onChanged: (callback: (settings: Record<string, unknown>) => void) => () => void
  testConnection: (options: { baseUrl: string; apiKey: string; model: string }) => Promise<{ success: boolean; message: string }>
}

interface AskUserOption {
  label: string
  description?: string
}

interface AskUserRequest {
  id: string
  question: string
  options?: AskUserOption[]
}

interface AgentApi {
  sendMessage: (prompt: string, sessionId?: string, activeFilePath?: string) => Promise<{ started: boolean }>
  getSessionList: () => Promise<SessionInfo[]>
  onMessage: (callback: (data: AgentMessageData) => void) => () => void
  onStreamEvent: (callback: (data: unknown) => void) => () => void
  onSessionCreated: (callback: (sessionId: string) => void) => () => void
  onComplete: (callback: (data: { sessionId: string }) => void) => () => void
  onError: (callback: (data: { sessionId: string; error: string }) => void) => () => void
  onPermissionRequest: (callback: (request: { id: string; toolName: string; input: Record<string, unknown> }) => void) => () => void
  respondPermission: (requestId: string, behavior: 'allow' | 'deny') => Promise<{ success: boolean }>
  onAskUser: (callback: (data: AskUserRequest) => void) => () => void
  respondAskUser: (requestId: string, answer: string) => Promise<{ success: boolean }>
  onAskUserTimeout: (callback: (data: { requestId: string }) => void) => () => void
  listSdkSessions: () => Promise<Array<{ id: string; title?: string; createdAt?: number; lastModified?: number }>>
  loadSessionMessages: (sessionId: string) => Promise<Array<Record<string, unknown>>>
}

interface GraphApi {
  getData: () => Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }>
  extractSemantic: () => Promise<{ success: boolean; error?: string; skipped?: boolean; message?: string; nodes?: number; edges?: number }>
  onFilesChanged: (callback: (data: { count: number; files: string[] }) => void) => () => void
  onSemanticProgress: (callback: (data: { phase: string; progress: number }) => void) => () => void
}

interface GraphNode {
  id: string
  label: string
  type: 'file' | 'memory' | 'entity'
  entityType?: string
}

interface GraphEdge {
  source: string
  target: string
  label?: string
  type: 'reference' | 'semantic'
}

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

interface CronApi {
  register: (cronExpression: string, prompt: string, name?: string) => Promise<{ success: boolean; task?: CronTask; error?: string }>
  list: () => Promise<CronTask[]>
  remove: (taskId: string) => Promise<boolean>
  execute: (taskId: string) => Promise<{ success: boolean; result?: string; error?: string }>
  onTaskCompleted: (callback: (data: { taskId: string; result: string }) => void) => () => void
}

interface SkillDefinition {
  id: string
  name: string
  description: string
  icon: string
  promptTemplate: string
  argumentHint?: string
}

interface SkillsApi {
  list: () => Promise<SkillDefinition[]>
}

interface SearchResult {
  filePath: string
  fileName: string
  line: number
  content: string
}

interface SearchApi {
  query: (keyword: string) => Promise<SearchResult[]>
}

interface MenuApi {
  onAction: (callback: (action: string) => void) => () => void
}

interface NotificationHistoryItem {
  id: string
  groupId: string
  title: string
  body: string
}

interface NotificationApi {
  getHistory: () => Promise<NotificationHistoryItem[]>
}

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

interface AgentMessageData {
  sessionId: string
  message: Record<string, unknown>
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
  AgentMessageData,
  AskUserOption,
  AskUserRequest,
  GraphNode,
  GraphEdge,
  CronTask,
  SkillDefinition,
  SearchResult
}