import { contextBridge, ipcRenderer } from 'electron'
import type {
  AgentIPCMessageWithContext,
  AgentNotificationEvent,
  AgentSessionEnvelope,
  ModelProfile,
  SessionRoutedAskUserRequest,
  SessionRoutedPermissionRequest,
  InlineRewriteRequest,
  SessionRoutedGenerationActivity,
} from '../shared/types'
import type { IPCChannelMap, IPCEventPayload, IPCRequest, IPCResponse } from '../shared/ipc-types'
import type { MarkitdownFormat } from '../shared/markitdown-runtime'

type AgentSendMessageRequest = IPCRequest<'agent:sendMessage'>
type AgentPermissionResponseRequest = IPCRequest<'agent:permissionResponse'>
type AgentRespondAskUserRequest = IPCRequest<'agent:respondAskUser'>
type AgentListSdkSessionsRequest = IPCRequest<'agent:listSdkSessions'>
type AgentLoadSessionMessagesPaginatedRequest = IPCRequest<'agent:loadSessionMessagesPaginated'>
type AgentRenameSessionRequest = IPCRequest<'agent:renameSession'>
type AgentUpdateSessionRecordRequest = IPCRequest<'agent:updateSessionRecord'>
type AgentRemoveSessionRecordRequest = IPCRequest<'agent:removeSessionRecord'>
type AgentDeleteSessionRequest = IPCRequest<'agent:deleteSession'>
type AgentGetSessionOutputsRequest = IPCRequest<'agent:getSessionOutputs'>
type AgentRevealSessionOutputRequest = IPCRequest<'agent:revealSessionOutput'>
type AgentDeleteSessionOutputRequest = IPCRequest<'agent:deleteSessionOutput'>
type AgentSetPermissionModeRequest = IPCRequest<'agent:setPermissionMode'>
type AgentAbortRequest = IPCRequest<'agent:abort'>
type SkillsChangedPayload = IPCEventPayload<'skills:changed'>
type SessionFilesChangedPayload = IPCEventPayload<'agent:sessionFilesChanged'>
type UpdateAvailablePayload = IPCEventPayload<'update:available'>
type UpdateDownloadProgressPayload = IPCEventPayload<'update:download-progress'>
type UpdateErrorEventPayload = IPCEventPayload<'update:error'>
type MainErrorPayload = IPCEventPayload<'main:error'>
type CronRegisterRequest = IPCRequest<'cron:register'>
type CronResolveScheduleRequest = IPCRequest<'cron:resolveSchedule'>
type CronSetStatusRequest = IPCRequest<'cron:setStatus'>
type CronTaskCompletedPayload = IPCEventPayload<'cron:taskCompleted'>

type IPCInvokeArguments<K extends keyof IPCChannelMap> =
  IPCRequest<K> extends void
    ? []
    : IPCRequest<K> extends unknown[]
      ? number extends IPCRequest<K>['length']
        ? [IPCRequest<K>]
        : IPCRequest<K>
      : [IPCRequest<K>]

function invoke<K extends keyof IPCChannelMap>(
  channel: K,
  ...args: IPCInvokeArguments<K>
): Promise<IPCResponse<K>> {
  return ipcRenderer.invoke(channel, ...args) as Promise<IPCResponse<K>>
}

const api = {
  getVersion: (): Promise<string> => invoke('app:getVersion'),

  workspace: {
    readFile: (filePath: string) => invoke('workspace:readFile', filePath),
    writeFile: (filePath: string, content: string) =>
      invoke('workspace:writeFile', filePath, content),
    addToKnowledge: (sourcePath: string, sessionId?: string) =>
      invoke('workspace:addToKnowledge', { sourcePath, sessionId }),
    listMarkdownFiles: (dirPath: string) => invoke('workspace:listMarkdownFiles', dirPath),
    openInBrowser: (filePath: string) => invoke('workspace:openInBrowser', filePath),
    saveArtifact: (options: { fileName: string; content: string; defaultPath?: string }) =>
      invoke('workspace:saveArtifact', options),
    previewArtifact: (options: { fileName: string; content: string }) =>
      invoke('workspace:previewArtifact', options),
    createWorkspace: (name: string) => invoke('workspace:createWorkspace', name),
    deleteWorkspace: (dirPath: string) =>
      invoke('workspace:deleteWorkspace', dirPath),
    knowledgeDir: () => invoke('workspace:knowledgeDir'),
    selectFiles: () => invoke('workspace:selectFiles'),
  },

  editor: {
    prepareRewrite: (request: Pick<InlineRewriteRequest, 'requestId' | 'filePath'>) =>
      invoke('editor:prepareRewrite', request),
    rewriteSelection: (request: InlineRewriteRequest) => invoke('editor:rewriteSelection', request),
    cancelRewrite: (requestId: string) => invoke('editor:cancelRewrite', { requestId }),
  },

  settings: {
    get: () => invoke('settings:get'),
    addProfile: (profile: ModelProfile) => invoke('settings:addProfile', profile),
    updateProfile: (id: string, updates: Partial<ModelProfile>) =>
      invoke('settings:updateProfile', id, updates),
    removeProfile: (id: string) => invoke('settings:removeProfile', id),
    setActiveProfile: (id: string) => invoke('settings:setActiveProfile', id),
    addDirectory: (dir: string) => invoke('settings:addDirectory', dir),
    removeDirectory: (dir: string) => invoke('settings:removeDirectory', dir),
    reorderDirectories: (paths: string[]) => invoke('settings:reorderDirectories', paths),
    setTheme: (theme: 'light' | 'dark' | 'system') => invoke('settings:setTheme', theme),
    onChanged: (callback: (settings: Record<string, unknown>) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, settings: Record<string, unknown>) => callback(settings)
      ipcRenderer.on('settings:changed', handler)
      return () => { ipcRenderer.removeListener('settings:changed', handler) }
    },
    testConnection: (options: { baseUrl: string; apiKey: string; model: string }) =>
      invoke('settings:testConnection', options)
  },

  // ─── Agent API (typed, unified event channel) ────────────────────────
  agent: {
    // Request/response channels
    sendMessage: (prompt: string, sessionId?: string, activeFilePath?: string, skillId?: string, context?: 'editor' | 'ask', workspacePath?: string, title?: string, clientSessionKey?: string, approvalMode?: import('../shared/types').AgentApprovalMode) => {
      const request: AgentSendMessageRequest = {
        prompt,
        sessionId,
        activeFilePath,
        skillId,
        context,
        workspacePath,
        title,
        clientSessionKey,
        approvalMode,
      }
      return invoke('agent:sendMessage', request)
    },
    respondPermission: (requestId: string, behavior: 'allow' | 'deny', options?: { updatedPermissions?: Array<Record<string, unknown>>; decisionClassification?: 'user_temporary' | 'user_permanent' | 'user_reject' }) => {
      const request: AgentPermissionResponseRequest = { requestId, behavior, options }
      return invoke('agent:permissionResponse', request)
    },
    respondAskUser: (requestId: string, answers: Record<string, string>) => {
      const request: AgentRespondAskUserRequest = { requestId, answers }
      return invoke('agent:respondAskUser', request)
    },
    listSdkSessions: (workspaceCwd?: string) => {
      const request: AgentListSdkSessionsRequest = { workspaceCwd }
      return invoke('agent:listSdkSessions', request)
    },
    loadSessionMessagesPaginated: (sessionId: string, limit: number, offset: number) => {
      const request: AgentLoadSessionMessagesPaginatedRequest = { sessionId, limit, offset }
      return invoke('agent:loadSessionMessagesPaginated', request)
    },
    renameSession: (sessionId: string, title: string) => {
      const request: AgentRenameSessionRequest = { sessionId, title }
      return invoke('agent:renameSession', request)
    },
    updateSessionRecord: (sessionId: string, patch: Record<string, unknown>) => {
      const request: AgentUpdateSessionRecordRequest = { sessionId, patch }
      return invoke('agent:updateSessionRecord', request)
    },
    removeSessionRecord: (sessionId: string) => {
      const request: AgentRemoveSessionRecordRequest = { sessionId }
      return invoke('agent:removeSessionRecord', request)
    },
    abort: (contextOrSessionId?: string) => {
      const request: AgentAbortRequest = { contextOrSessionId }
      return invoke('agent:abort', request)
    },
    setPermissionMode: (queryKey: string, mode: import('../shared/types').AgentApprovalMode) => {
      const request: AgentSetPermissionModeRequest = { queryKey, mode }
      return invoke('agent:setPermissionMode', request)
    },
    selectFolder: () => invoke('agent:selectFolder'),
    getSessionOutputs: (sessionId: string) => {
      const request: AgentGetSessionOutputsRequest = { sessionId }
      return invoke('agent:getSessionOutputs', request)
    },
    revealSessionOutput: (sessionId: string, filePath: string) => {
      const request: AgentRevealSessionOutputRequest = { sessionId, filePath }
      return invoke('agent:revealSessionOutput', request)
    },
    deleteSessionOutput: (sessionId: string, filePath: string) => {
      const request: AgentDeleteSessionOutputRequest = { sessionId, filePath }
      return invoke('agent:deleteSessionOutput', request)
    },
    deleteSession: (sessionId: string) => {
      const request: AgentDeleteSessionRequest = { sessionId }
      return invoke('agent:deleteSession', request)
    },

    // ── Unified event channel ────────────────────────────────────────
    // All SDK messages (assistant, user, result, stream_event, system)
    // arrive through this single channel as typed AgentIPCMessage.
    onEvent: (callback: (msg: AgentIPCMessageWithContext) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, msg: AgentIPCMessageWithContext) => callback(msg)
      ipcRenderer.on('agent:event', handler)
      return () => { ipcRenderer.removeListener('agent:event', handler) }
    },

    // ── Lifecycle channels (separate for request/response patterns) ──
    onSessionCreated: (callback: (data: AgentSessionEnvelope) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: AgentSessionEnvelope) => callback(data)
      ipcRenderer.on('agent:sessionCreated', handler)
      return () => { ipcRenderer.removeListener('agent:sessionCreated', handler) }
    },

    onSessionFilesChanged: (callback: (data: SessionFilesChangedPayload) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: SessionFilesChangedPayload) => callback(data)
      ipcRenderer.on('agent:sessionFilesChanged', handler)
      return () => { ipcRenderer.removeListener('agent:sessionFilesChanged', handler) }
    },

    onPermissionRequest: (callback: (request: SessionRoutedPermissionRequest) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, request: SessionRoutedPermissionRequest) => callback(request)
      ipcRenderer.on('agent:permissionRequest', handler)
      return () => { ipcRenderer.removeListener('agent:permissionRequest', handler) }
    },

    onAskUser: (callback: (request: SessionRoutedAskUserRequest) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, request: SessionRoutedAskUserRequest) => callback(request)
      ipcRenderer.on('agent:askUser', handler)
      return () => { ipcRenderer.removeListener('agent:askUser', handler) }
    },

    onAskUserTimeout: (callback: (data: { requestId: string } & AgentSessionEnvelope) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { requestId: string } & AgentSessionEnvelope) => callback(data)
      ipcRenderer.on('agent:askUserTimeout', handler)
      return () => { ipcRenderer.removeListener('agent:askUserTimeout', handler) }
    },

    onPermissionTimeout: (callback: (data: { requestId: string } & AgentSessionEnvelope) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { requestId: string } & AgentSessionEnvelope) => callback(data)
      ipcRenderer.on('agent:permissionTimeout', handler)
      return () => { ipcRenderer.removeListener('agent:permissionTimeout', handler) }
    },

    onGenerationActivity: (callback: (state: SessionRoutedGenerationActivity) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, state: SessionRoutedGenerationActivity) => callback(state)
      ipcRenderer.on('agent:generationActivity', handler)
      return () => { ipcRenderer.removeListener('agent:generationActivity', handler) }
    },

    onNotification: (callback: (data: AgentNotificationEvent) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: AgentNotificationEvent) => callback(data)
      ipcRenderer.on('agent:notification', handler)
      return () => { ipcRenderer.removeListener('agent:notification', handler) }
    },
  },

  memory: {
    list: () => invoke('memory:list'),
    read: (filePath: string) => invoke('memory:read', filePath),
    update: (filePath: string, content: string) => invoke('memory:update', { filePath, content }),
    delete: (filePath: string) => invoke('memory:delete', filePath)
  },

  graph: {
    getData: () => invoke('graph:getData'),
    acknowledgeChanges: (version: number) => invoke('graph:acknowledgeChanges', version),
    onFilesChanged: (callback: (data: { count: number; files: string[]; version: number }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { count: number; files: string[]; version: number }) => callback(data)
      ipcRenderer.on('graph:filesChanged', handler)
      return () => { ipcRenderer.removeListener('graph:filesChanged', handler) }
    }
  },

  cron: {
    register: (request: CronRegisterRequest) =>
      invoke('cron:register', request),
    list: () => invoke('cron:list'),
    resolveSchedule: (request: CronResolveScheduleRequest) =>
      invoke('cron:resolveSchedule', request),
    remove: (taskId: string) => invoke('cron:remove', taskId),
    execute: (taskId: string) => invoke('cron:execute', taskId),
    stop: (taskId: string) => invoke('cron:stop', taskId),
    setStatus: (taskId: string, status: CronSetStatusRequest['status']) =>
      invoke('cron:setStatus', { taskId, status }),
    onTaskCompleted: (callback: (data: CronTaskCompletedPayload) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: CronTaskCompletedPayload) => callback(data)
      ipcRenderer.on('cron:taskCompleted', handler)
      return () => { ipcRenderer.removeListener('cron:taskCompleted', handler) }
    }
  },

  skills: {
    list: () => invoke('skills:list'),
    toggle: (skillId: string, enabled: boolean) => invoke('skills:toggle', skillId, enabled),
    builtins: () => invoke('skills:builtins'),
    catalog: () => invoke('skills:catalog'),
    install: (skillId: string) => invoke('skills:install', skillId),
    update: (skillId: string) => invoke('skills:update', skillId),
    uninstall: (skillId: string) => invoke('skills:uninstall', skillId),
    onChanged: (callback: (change: SkillsChangedPayload) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, change: SkillsChangedPayload) => callback(change)
      ipcRenderer.on('skills:changed', handler)
      return () => { ipcRenderer.removeListener('skills:changed', handler) }
    },
  },

  attachments: {
    runtimeStatus: (formats?: MarkitdownFormat[]) => invoke('attachments:runtimeStatus', { formats }),
    installRuntime: () => invoke('attachments:installRuntime'),
  },

  search: {
    query: (keyword: string) => invoke('search:query', keyword)
  },

  menu: {
    onAction: (callback: (action: string) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, action: string) => callback(action)
      ipcRenderer.on('menu-action', handler)
      return () => { ipcRenderer.removeListener('menu-action', handler) }
    }
  },

  update: {
    download: () => invoke('update:download'),
    install: () => invoke('update:install'),
    openLatestRelease: () => invoke('update:openLatestRelease'),
    checkForUpdates: () => invoke('update:checkForUpdates'),
    onAvailable: (callback: (info: UpdateAvailablePayload) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, info: UpdateAvailablePayload) => callback(info)
      ipcRenderer.on('update:available', handler)
      return () => { ipcRenderer.removeListener('update:available', handler) }
    },
    onDownloaded: (callback: () => void) => {
      const handler = (_event: Electron.IpcRendererEvent) => callback()
      ipcRenderer.on('update:downloaded', handler)
      return () => { ipcRenderer.removeListener('update:downloaded', handler) }
    },
    onDownloadProgress: (callback: (progress: UpdateDownloadProgressPayload) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, progress: UpdateDownloadProgressPayload) => callback(progress)
      ipcRenderer.on('update:download-progress', handler)
      return () => { ipcRenderer.removeListener('update:download-progress', handler) }
    },
    onError: (callback: (error: UpdateErrorEventPayload) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, error: UpdateErrorEventPayload) => callback(error)
      ipcRenderer.on('update:error', handler)
      return () => { ipcRenderer.removeListener('update:error', handler) }
    }
  },

  onMainError: (callback: (error: MainErrorPayload) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, error: MainErrorPayload) => callback(error)
    ipcRenderer.on('main:error', handler)
    return () => { ipcRenderer.removeListener('main:error', handler) }
  }
}

contextBridge.exposeInMainWorld('api', api)
