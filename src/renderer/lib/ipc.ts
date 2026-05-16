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
  apiProvider: 'anthropic' | 'bedrock' | 'vertex' | 'azure' | 'custom'
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
  listMarkdownFiles: (dirPath: string) => Promise<Array<{ label: string; path: string }>>
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
}

interface AgentApi {
  sendMessage: (prompt: string, sessionId?: string) => Promise<{ started: boolean }>
  getSessionList: () => Promise<SessionInfo[]>
  onMessage: (callback: (data: AgentMessageData) => void) => () => void
  onSessionCreated: (callback: (sessionId: string) => void) => () => void
  onComplete: (callback: (data: { sessionId: string }) => void) => () => void
  onError: (callback: (data: { sessionId: string; error: string }) => void) => () => void
}

interface GraphApi {
  getData: () => Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }>
}

interface GraphNode {
  id: string
  label: string
  type: 'file' | 'memory'
}

interface GraphEdge {
  source: string
  target: string
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

interface SlashCommand {
  name: string
  description: string
  argumentHint: string
  aliases?: string[]
}

interface SkillsApi {
  list: () => Promise<SlashCommand[]>
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
  FileEntry,
  ModelProfile,
  AppSettings,
  SessionInfo,
  AgentMessageData,
  GraphNode,
  GraphEdge,
  CronTask,
  SlashCommand,
  SearchResult
}