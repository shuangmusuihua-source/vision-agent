import { contextBridge, ipcRenderer } from 'electron'
import type {
  AgentIPCMessageWithContext,
  AgentNotificationEvent,
  AgentSessionEnvelope,
  ModelProfile,
  SdkSessionInfo,
  SessionRoutedAskUserRequest,
  SessionRoutedPermissionRequest,
  SessionRoutedSkillOutputState,
} from '../shared/types'
import type { IPCChannelMap, IPCEventPayload, IPCRequest, IPCResponse } from '../shared/ipc-types'
import type { MarkitdownFormat } from '../shared/markitdown-runtime'
import type { UpdateDownloadProgress, UpdateErrorPayload } from '../shared/update-types'

type AgentSendMessageRequest = IPCRequest<'agent:sendMessage'>
type AgentPermissionResponseRequest = IPCRequest<'agent:permissionResponse'>
type AgentRespondAskUserRequest = IPCRequest<'agent:respondAskUser'>
type AgentListSdkSessionsRequest = IPCRequest<'agent:listSdkSessions'>
type AgentLoadSessionMessagesRequest = IPCRequest<'agent:loadSessionMessages'>
type AgentLoadSessionMessagesPaginatedRequest = IPCRequest<'agent:loadSessionMessagesPaginated'>
type AgentRenameSessionRequest = IPCRequest<'agent:renameSession'>
type AgentUpdateSessionRecordRequest = IPCRequest<'agent:updateSessionRecord'>
type AgentRemoveSessionRecordRequest = IPCRequest<'agent:removeSessionRecord'>
type AgentDeleteSessionRequest = IPCRequest<'agent:deleteSession'>
type AgentGetSessionOutputsRequest = IPCRequest<'agent:getSessionOutputs'>
type AgentSetPermissionModeRequest = IPCRequest<'agent:setPermissionMode'>
type AgentForkSessionRequest = IPCRequest<'agent:forkSession'>
type AgentAbortRequest = IPCRequest<'agent:abort'>
type SkillsChangedPayload = IPCEventPayload<'skills:changed'>

function invoke<K extends keyof IPCChannelMap>(
  channel: K,
  request: IPCRequest<K>
): Promise<IPCResponse<K>> {
  return ipcRenderer.invoke(channel, request) as Promise<IPCResponse<K>>
}

const api = {
  ping: (): Promise<string> => ipcRenderer.invoke('ping'),
  getVersion: (): Promise<string> => ipcRenderer.invoke('app:getVersion'),

  workspace: {
    readFile: (filePath: string) => ipcRenderer.invoke('workspace:readFile', filePath),
    writeFile: (filePath: string, content: string) =>
      ipcRenderer.invoke('workspace:writeFile', filePath, content),
    addToKnowledge: (sourcePath: string, sessionId?: string) =>
      invoke('workspace:addToKnowledge', { sourcePath, sessionId }),
    listMarkdownFiles: (dirPath: string) => ipcRenderer.invoke('workspace:listMarkdownFiles', dirPath),
    openInBrowser: (filePath: string) => ipcRenderer.invoke('workspace:openInBrowser', filePath),
    saveArtifact: (options: { fileName: string; content: string; defaultPath?: string }) =>
      ipcRenderer.invoke('workspace:saveArtifact', options),
    previewArtifact: (options: { fileName: string; content: string }) =>
      ipcRenderer.invoke('workspace:previewArtifact', options),
    createWorkspace: (name: string) => ipcRenderer.invoke('workspace:createWorkspace', name),
    deleteWorkspace: (dirPath: string) =>
      ipcRenderer.invoke('workspace:deleteWorkspace', dirPath),
    knowledgeDir: () => ipcRenderer.invoke('workspace:knowledgeDir'),
    selectFiles: () => ipcRenderer.invoke('workspace:selectFiles'),
  },

  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    addProfile: (profile: ModelProfile) => ipcRenderer.invoke('settings:addProfile', profile),
    updateProfile: (id: string, updates: Partial<ModelProfile>) =>
      ipcRenderer.invoke('settings:updateProfile', id, updates),
    removeProfile: (id: string) => ipcRenderer.invoke('settings:removeProfile', id),
    setActiveProfile: (id: string) => ipcRenderer.invoke('settings:setActiveProfile', id),
    addDirectory: (dir: string) => ipcRenderer.invoke('settings:addDirectory', dir),
    removeDirectory: (dir: string) => ipcRenderer.invoke('settings:removeDirectory', dir),
    reorderDirectories: (paths: string[]) => ipcRenderer.invoke('settings:reorderDirectories', paths),
    getTheme: () => ipcRenderer.invoke('settings:getTheme'),
    setTheme: (theme: 'light' | 'dark' | 'system') => ipcRenderer.invoke('settings:setTheme', theme),
    onChanged: (callback: (settings: Record<string, unknown>) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, settings: Record<string, unknown>) => callback(settings)
      ipcRenderer.on('settings:changed', handler)
      return () => { ipcRenderer.removeListener('settings:changed', handler) }
    },
    testConnection: (options: { baseUrl: string; apiKey: string; model: string }) =>
      ipcRenderer.invoke('settings:testConnection', options)
  },

  // ─── Agent API (typed, unified event channel) ────────────────────────
  agent: {
    // Request/response channels
    sendMessage: (prompt: string, sessionId?: string, activeFilePath?: string, skillId?: string, context?: 'editor' | 'ask', workspacePath?: string, title?: string, clientSessionKey?: string) => {
      const request: AgentSendMessageRequest = {
        prompt,
        sessionId,
        activeFilePath,
        skillId,
        context,
        workspacePath,
        title,
        clientSessionKey,
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
    loadSessionMessages: (sessionId: string) => {
      const request: AgentLoadSessionMessagesRequest = { sessionId }
      return invoke('agent:loadSessionMessages', request)
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
    setPermissionMode: (context: 'editor' | 'ask', mode: string) => {
      const request: AgentSetPermissionModeRequest = { context, mode }
      return invoke('agent:setPermissionMode', request)
    },
    forkSession: (sessionId: string, options?: { upToMessageId?: string; title?: string }) => {
      const request: AgentForkSessionRequest = { sessionId, options }
      return invoke('agent:forkSession', request)
    },
    selectFolder: () => invoke('agent:selectFolder', undefined),
    getSessionOutputs: (sessionId: string) => {
      const request: AgentGetSessionOutputsRequest = { sessionId }
      return invoke('agent:getSessionOutputs', request)
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

    onSkillOutput: (callback: (state: SessionRoutedSkillOutputState) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, state: SessionRoutedSkillOutputState) => callback(state)
      ipcRenderer.on('skill:output', handler)
      return () => { ipcRenderer.removeListener('skill:output', handler) }
    },

    onNotification: (callback: (data: AgentNotificationEvent) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: AgentNotificationEvent) => callback(data)
      ipcRenderer.on('agent:notification', handler)
      return () => { ipcRenderer.removeListener('agent:notification', handler) }
    },
  },

  memory: {
    list: (workspacePath?: string) => ipcRenderer.invoke('memory:list', workspacePath),
    read: (filePath: string) => ipcRenderer.invoke('memory:read', filePath),
    write: (filePath: string, content: string) => ipcRenderer.invoke('memory:write', filePath, content),
    delete: (filePath: string) => ipcRenderer.invoke('memory:delete', filePath)
  },

  graph: {
    getData: () => ipcRenderer.invoke('graph:getData'),
    acknowledgeChanges: (version: number) => ipcRenderer.invoke('graph:acknowledgeChanges', version),
    onFilesChanged: (callback: (data: { count: number; files: string[]; version: number }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { count: number; files: string[]; version: number }) => callback(data)
      ipcRenderer.on('graph:filesChanged', handler)
      return () => { ipcRenderer.removeListener('graph:filesChanged', handler) }
    }
  },

  cron: {
    register: (cronExpression: string, prompt: string, name?: string) =>
      ipcRenderer.invoke('cron:register', cronExpression, prompt, name),
    list: () => ipcRenderer.invoke('cron:list'),
    remove: (taskId: string) => ipcRenderer.invoke('cron:remove', taskId),
    execute: (taskId: string) => ipcRenderer.invoke('cron:execute', taskId),
    onTaskCompleted: (callback: (data: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data)
      ipcRenderer.on('cron:taskCompleted', handler)
      return () => { ipcRenderer.removeListener('cron:taskCompleted', handler) }
    }
  },

  skills: {
    list: () => ipcRenderer.invoke('skills:list'),
    toggle: (skillId: string, enabled: boolean) => ipcRenderer.invoke('skills:toggle', skillId, enabled),
    getEnabled: () => ipcRenderer.invoke('skills:getEnabled'),
    builtins: () => ipcRenderer.invoke('skills:builtins'),
    catalog: () => ipcRenderer.invoke('skills:catalog'),
    install: (skillId: string) => ipcRenderer.invoke('skills:install', skillId),
    update: (skillId: string) => ipcRenderer.invoke('skills:update', skillId),
    uninstall: (skillId: string) => ipcRenderer.invoke('skills:uninstall', skillId),
    onChanged: (callback: (change: SkillsChangedPayload) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, change: SkillsChangedPayload) => callback(change)
      ipcRenderer.on('skills:changed', handler)
      return () => { ipcRenderer.removeListener('skills:changed', handler) }
    },
  },

  attachments: {
    runtimeStatus: (formats?: MarkitdownFormat[]) => invoke('attachments:runtimeStatus', { formats }),
    installRuntime: () => invoke('attachments:installRuntime', undefined),
  },

  search: {
    query: (keyword: string) => ipcRenderer.invoke('search:query', keyword)
  },

  menu: {
    onAction: (callback: (action: string) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, action: string) => callback(action)
      ipcRenderer.on('menu-action', handler)
      return () => { ipcRenderer.removeListener('menu-action', handler) }
    }
  },

  notification: {
    getHistory: () => ipcRenderer.invoke('notification:getHistory')
  },

  update: {
    download: () => ipcRenderer.invoke('update:download'),
    install: () => ipcRenderer.invoke('update:install'),
    openLatestRelease: () => ipcRenderer.invoke('update:openLatestRelease'),
    checkForUpdates: () => ipcRenderer.invoke('update:checkForUpdates'),
    onAvailable: (callback: (info: { version: string }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, info: { version: string }) => callback(info)
      ipcRenderer.on('update:available', handler)
      return () => { ipcRenderer.removeListener('update:available', handler) }
    },
    onDownloaded: (callback: () => void) => {
      const handler = (_event: Electron.IpcRendererEvent) => callback()
      ipcRenderer.on('update:downloaded', handler)
      return () => { ipcRenderer.removeListener('update:downloaded', handler) }
    },
    onDownloadProgress: (callback: (progress: UpdateDownloadProgress) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, progress: UpdateDownloadProgress) => callback(progress)
      ipcRenderer.on('update:download-progress', handler)
      return () => { ipcRenderer.removeListener('update:download-progress', handler) }
    },
    onError: (callback: (error: UpdateErrorPayload) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, error: UpdateErrorPayload) => callback(error)
      ipcRenderer.on('update:error', handler)
      return () => { ipcRenderer.removeListener('update:error', handler) }
    }
  },

  onMainError: (callback: (error: { type: string; message: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, error: { type: string; message: string }) => callback(error)
    ipcRenderer.on('main:error', handler)
    return () => { ipcRenderer.removeListener('main:error', handler) }
  }
}

contextBridge.exposeInMainWorld('api', api)
