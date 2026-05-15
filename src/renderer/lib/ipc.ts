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
}

interface AgentApi {
  sendMessage: (prompt: string, sessionId?: string) => Promise<{ started: boolean }>
  getSessionList: () => Promise<SessionInfo[]>
  onMessage: (callback: (data: AgentMessageData) => void) => () => void
  onSessionCreated: (callback: (sessionId: string) => void) => () => void
  onComplete: (callback: (data: { sessionId: string }) => void) => () => void
  onError: (callback: (data: { sessionId: string; error: string }) => void) => () => void
}

interface WindowApi {
  ping: () => Promise<string>
  workspace: WorkspaceApi
  settings: SettingsApi
  agent: AgentApi
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
  FileEntry,
  ModelProfile,
  AppSettings,
  SessionInfo,
  AgentMessageData
}