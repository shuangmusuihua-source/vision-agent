import type {
  AgentApprovalMode,
  AgentContext,
  AgentIPCMessageWithContext,
  AgentNotificationEvent,
  AgentSessionEnvelope,
  BuiltinSkillCatalogItem,
  CommunitySkillCatalogItem,
  CommunitySkillMutationResult,
  GraphData,
  InlineRewriteRequest,
  MemoryDocument,
  MemoryEntry,
  ModelProfile,
  SessionOutputs,
  SessionRoutedAskUserRequest,
  SessionRoutedGenerationActivity,
  SessionRoutedPermissionRequest,
} from './types'
import type {
  AppSettingsSnapshot,
  IPCEventPayload,
  IPCRequest,
  IPCResponse,
  SearchResult,
  SkillDefinition,
} from './ipc-types'
import type {
  CronScheduleParseRequest,
  CronScheduleParseResponse,
  CronTask,
  CronTaskRegistration,
} from './cron-types'
import type { MarkitdownFormat } from './markitdown-runtime'

type Unsubscribe = () => void
type Subscription<K extends keyof import('./ipc-types').IPCEventMap> =
  (callback: (payload: IPCEventPayload<K>) => void) => Unsubscribe

export interface WorkspaceApi {
  readFile: (filePath: string) => Promise<IPCResponse<'workspace:readFile'>>
  writeFile: (filePath: string, content: string) => Promise<IPCResponse<'workspace:writeFile'>>
  savePastedImage: (
    request: IPCRequest<'workspace:savePastedImage'>,
  ) => Promise<IPCResponse<'workspace:savePastedImage'>>
  readImageAsset: (
    request: IPCRequest<'workspace:readImageAsset'>,
  ) => Promise<IPCResponse<'workspace:readImageAsset'>>
  addToKnowledge: (
    sourcePath: string,
    sessionId?: string,
  ) => Promise<IPCResponse<'workspace:addToKnowledge'>>
  createWorkspace: (name: string) => Promise<IPCResponse<'workspace:createWorkspace'>>
  deleteWorkspace: (dirPath: string) => Promise<IPCResponse<'workspace:deleteWorkspace'>>
  selectFiles: () => Promise<IPCResponse<'workspace:selectFiles'>>
  listMarkdownFiles: (dirPath: string) => Promise<IPCResponse<'workspace:listMarkdownFiles'>>
  openInBrowser: (filePath: string) => Promise<IPCResponse<'workspace:openInBrowser'>>
  openExternalUrl: (url: string) => Promise<IPCResponse<'workspace:openExternalUrl'>>
  saveArtifact: (
    options: IPCRequest<'workspace:saveArtifact'>,
  ) => Promise<IPCResponse<'workspace:saveArtifact'>>
  previewArtifact: (
    options: IPCRequest<'workspace:previewArtifact'>,
  ) => Promise<IPCResponse<'workspace:previewArtifact'>>
}

export interface EditorApi {
  prepareRewrite: (
    request: Pick<InlineRewriteRequest, 'requestId' | 'filePath'>,
  ) => Promise<IPCResponse<'editor:prepareRewrite'>>
  rewriteSelection: (
    request: InlineRewriteRequest,
  ) => Promise<IPCResponse<'editor:rewriteSelection'>>
  cancelRewrite: (requestId: string) => Promise<IPCResponse<'editor:cancelRewrite'>>
}

export interface SettingsApi {
  get: () => Promise<AppSettingsSnapshot>
  addProfile: (profile: ModelProfile) => Promise<IPCResponse<'settings:addProfile'>>
  updateProfile: (
    id: string,
    updates: Partial<ModelProfile>,
  ) => Promise<IPCResponse<'settings:updateProfile'>>
  removeProfile: (id: string) => Promise<IPCResponse<'settings:removeProfile'>>
  setActiveProfile: (id: string) => Promise<IPCResponse<'settings:setActiveProfile'>>
  reorderDirectories: (
    paths: string[],
  ) => Promise<IPCResponse<'settings:reorderDirectories'>>
  setTheme: (
    theme: AppSettingsSnapshot['theme'],
  ) => Promise<IPCResponse<'settings:setTheme'>>
  onChanged: Subscription<'settings:changed'>
  testConnection: (
    options: IPCRequest<'settings:testConnection'>,
  ) => Promise<IPCResponse<'settings:testConnection'>>
}

export interface AgentApi {
  sendMessage: (
    prompt: string,
    sessionId?: string,
    activeFilePath?: string,
    skillId?: string,
    context?: AgentContext,
    workspacePath?: string,
    title?: string,
    clientSessionKey?: string,
    approvalMode?: AgentApprovalMode,
  ) => Promise<IPCResponse<'agent:sendMessage'>>
  respondPermission: (
    requestId: string,
    behavior: 'allow' | 'deny',
    options?: {
      updatedPermissions?: Array<Record<string, unknown>>
      decisionClassification?: 'user_temporary' | 'user_permanent' | 'user_reject'
    },
  ) => Promise<IPCResponse<'agent:permissionResponse'>>
  respondAskUser: (
    requestId: string,
    answers: Record<string, string>,
  ) => Promise<IPCResponse<'agent:respondAskUser'>>
  listSdkSessions: (
    workspaceCwd?: string,
  ) => Promise<IPCResponse<'agent:listSdkSessions'>>
  loadSessionMessagesPaginated: (
    sessionId: string,
    limit: number,
    offset: number,
  ) => Promise<IPCResponse<'agent:loadSessionMessagesPaginated'>>
  renameSession: (
    sessionId: string,
    title: string,
  ) => Promise<IPCResponse<'agent:renameSession'>>
  updateSessionRecord: (
    sessionId: string,
    patch: IPCRequest<'agent:updateSessionRecord'>['patch'],
  ) => Promise<IPCResponse<'agent:updateSessionRecord'>>
  abort: (contextOrSessionId?: string) => Promise<IPCResponse<'agent:abort'>>
  setPermissionMode: (
    queryKey: string,
    mode: AgentApprovalMode,
  ) => Promise<IPCResponse<'agent:setPermissionMode'>>
  selectFolder: () => Promise<IPCResponse<'agent:selectFolder'>>
  getSessionOutputs: (
    sessionId: string,
  ) => Promise<IPCResponse<'agent:getSessionOutputs'>>
  revealSessionOutput: (
    sessionId: string,
    filePath: string,
  ) => Promise<IPCResponse<'agent:revealSessionOutput'>>
  openSessionOutput: (
    sessionId: string,
    filePath: string,
  ) => Promise<IPCResponse<'agent:openSessionOutput'>>
  deleteSessionOutput: (
    sessionId: string,
    filePath: string,
  ) => Promise<IPCResponse<'agent:deleteSessionOutput'>>
  deleteSession: (sessionId: string) => Promise<IPCResponse<'agent:deleteSession'>>
  removeSessionRecord: (
    sessionId: string,
  ) => Promise<IPCResponse<'agent:removeSessionRecord'>>
  onEvent: (callback: (message: AgentIPCMessageWithContext) => void) => Unsubscribe
  onSessionCreated: (callback: (data: AgentSessionEnvelope) => void) => Unsubscribe
  onSessionFilesChanged: (callback: (data: AgentSessionEnvelope) => void) => Unsubscribe
  onPermissionRequest: (
    callback: (data: SessionRoutedPermissionRequest) => void,
  ) => Unsubscribe
  onAskUser: (callback: (data: SessionRoutedAskUserRequest) => void) => Unsubscribe
  onAskUserTimeout: Subscription<'agent:askUserTimeout'>
  onPermissionTimeout: Subscription<'agent:permissionTimeout'>
  onNotification: (callback: (data: AgentNotificationEvent) => void) => Unsubscribe
  onGenerationActivity: (
    callback: (state: SessionRoutedGenerationActivity) => void,
  ) => Unsubscribe
}

export interface MemoryApi {
  list: () => Promise<MemoryEntry[]>
  read: (filePath: string) => Promise<IPCResponse<'memory:read'>>
  update: (
    filePath: string,
    content: string,
  ) => Promise<IPCResponse<'memory:update'>>
  delete: (filePath: string) => Promise<IPCResponse<'memory:delete'>>
}

export interface GraphApi {
  getData: () => Promise<GraphData>
  acknowledgeChanges: (
    version: number,
  ) => Promise<IPCResponse<'graph:acknowledgeChanges'>>
  onFilesChanged: Subscription<'graph:filesChanged'>
}

export interface CronApi {
  selectDirectory: () => Promise<IPCResponse<'cron:selectDirectory'>>
  register: (
    request: CronTaskRegistration,
  ) => Promise<IPCResponse<'cron:register'>>
  list: () => Promise<CronTask[]>
  resolveSchedule: (
    request: CronScheduleParseRequest,
  ) => Promise<CronScheduleParseResponse>
  remove: (taskId: string) => Promise<IPCResponse<'cron:remove'>>
  execute: (taskId: string) => Promise<IPCResponse<'cron:execute'>>
  stop: (taskId: string) => Promise<IPCResponse<'cron:stop'>>
  setStatus: (
    taskId: string,
    status: CronTask['status'],
  ) => Promise<IPCResponse<'cron:setStatus'>>
  onTaskCompleted: Subscription<'cron:taskCompleted'>
}

export interface SkillsApi {
  list: () => Promise<SkillDefinition[]>
  toggle: (
    skillId: string,
    enabled: boolean,
  ) => Promise<IPCResponse<'skills:toggle'>>
  builtins: () => Promise<BuiltinSkillCatalogItem[]>
  catalog: () => Promise<CommunitySkillCatalogItem[]>
  install: (skillId: string) => Promise<CommunitySkillMutationResult>
  update: (skillId: string) => Promise<CommunitySkillMutationResult>
  uninstall: (skillId: string) => Promise<CommunitySkillMutationResult>
  onChanged: Subscription<'skills:changed'>
}

export interface AttachmentsApi {
  runtimeStatus: (
    formats?: MarkitdownFormat[],
  ) => Promise<IPCResponse<'attachments:runtimeStatus'>>
  installRuntime: () => Promise<IPCResponse<'attachments:installRuntime'>>
}

export interface OfficeApi {
  runtimeStatus: () => Promise<IPCResponse<'office:runtimeStatus'>>
  installRuntime: () => Promise<IPCResponse<'office:installRuntime'>>
}

export interface SearchApi {
  query: (keyword: string) => Promise<SearchResult[]>
}

export interface MenuApi {
  onAction: Subscription<'menu-action'>
}

export interface UpdateApi {
  download: () => Promise<IPCResponse<'update:download'>>
  install: () => Promise<IPCResponse<'update:install'>>
  openLatestRelease: () => Promise<IPCResponse<'update:openLatestRelease'>>
  checkForUpdates: () => Promise<IPCResponse<'update:checkForUpdates'>>
  onAvailable: Subscription<'update:available'>
  onDownloaded: (callback: () => void) => Unsubscribe
  onDownloadProgress: Subscription<'update:download-progress'>
  onError: Subscription<'update:error'>
}

export interface WindowApi {
  getVersion: () => Promise<IPCResponse<'app:getVersion'>>
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
  onMainError: Subscription<'main:error'>
}

export type {
  AppSettingsSnapshot,
  SearchResult,
  SkillDefinition,
  SessionOutputs,
  MemoryDocument,
}
