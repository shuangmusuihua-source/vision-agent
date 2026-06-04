import { contextBridge, ipcRenderer } from 'electron'
import type { AgentIPCMessageWithContext, AgentContext, AskUserRequestIPC, PermissionRequestIPC, SdkSessionInfo, ModelProfile, SkillOutputState } from '../shared/types'

const api = {
  ping: (): Promise<string> => ipcRenderer.invoke('ping'),

  workspace: {
    listFiles: (dirPath: string) => ipcRenderer.invoke('workspace:listFiles', dirPath),
    readFile: (filePath: string) => ipcRenderer.invoke('workspace:readFile', filePath),
    writeFile: (filePath: string, content: string) =>
      ipcRenderer.invoke('workspace:writeFile', filePath, content),
    listMarkdownFiles: (dirPath: string) => ipcRenderer.invoke('workspace:listMarkdownFiles', dirPath),
    openDirectoryDialog: () => ipcRenderer.invoke('workspace:openDirectoryDialog'),
    openInBrowser: (filePath: string) => ipcRenderer.invoke('workspace:openInBrowser', filePath),
    saveArtifact: (options: { fileName: string; content: string; defaultPath?: string }) =>
      ipcRenderer.invoke('workspace:saveArtifact', options),
    previewArtifact: (options: { fileName: string; content: string }) =>
      ipcRenderer.invoke('workspace:previewArtifact', options),
    newDirectoryDialog: () => ipcRenderer.invoke('workspace:newDirectoryDialog'),
    createWorkspace: (name: string) => ipcRenderer.invoke('workspace:createWorkspace', name),
    createFile: (dirPath: string, fileName: string) =>
      ipcRenderer.invoke('workspace:createFile', dirPath, fileName),
    deleteFile: (filePath: string) =>
      ipcRenderer.invoke('workspace:deleteFile', filePath),
    renameFile: (filePath: string, newName: string) =>
      ipcRenderer.invoke('workspace:renameFile', filePath, newName),
    moveFile: (sourcePath: string, targetDir: string) =>
      ipcRenderer.invoke('workspace:moveFile', sourcePath, targetDir),
    deleteWorkspace: (dirPath: string) =>
      ipcRenderer.invoke('workspace:deleteWorkspace', dirPath),
    knowledgeDir: () => ipcRenderer.invoke('workspace:knowledgeDir'),
    createDir: (parentPath: string, dirName: string) =>
      ipcRenderer.invoke('workspace:createDir', parentPath, dirName),
    renameEntry: (oldPath: string, newName: string) =>
      ipcRenderer.invoke('workspace:renameEntry', oldPath, newName),
    deleteDir: (dirPath: string) =>
      ipcRenderer.invoke('workspace:deleteDir', dirPath),
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
    sendMessage: (prompt: string, sessionId?: string, activeFilePath?: string, skillId?: string, context?: 'editor' | 'ask') =>
      ipcRenderer.invoke('agent:sendMessage', prompt, sessionId, activeFilePath, skillId, context),
    getSessionList: () => ipcRenderer.invoke('agent:getSessionList'),
    respondPermission: (requestId: string, behavior: 'allow' | 'deny') =>
      ipcRenderer.invoke('agent:permissionResponse', requestId, behavior),
    respondAskUser: (requestId: string, answer: string) =>
      ipcRenderer.invoke('agent:respondAskUser', requestId, answer),
    listSdkSessions: () => ipcRenderer.invoke('agent:listSdkSessions'),
    loadSessionMessages: (sessionId: string) =>
      ipcRenderer.invoke('agent:loadSessionMessages', sessionId),
    abort: (context?: 'editor' | 'ask') => ipcRenderer.invoke('agent:abort', context),
    selectFolder: () => ipcRenderer.invoke('agent:selectFolder'),

    // ── Unified event channel ────────────────────────────────────────
    // All SDK messages (assistant, user, result, stream_event, system)
    // arrive through this single channel as typed AgentIPCMessage.
    onEvent: (callback: (msg: AgentIPCMessageWithContext) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, msg: AgentIPCMessageWithContext) => callback(msg)
      ipcRenderer.on('agent:event', handler)
      return () => { ipcRenderer.removeListener('agent:event', handler) }
    },

    // ── Lifecycle channels (separate for request/response patterns) ──
    onSessionCreated: (callback: (data: { context: 'editor' | 'ask'; sessionId: string }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { context: 'editor' | 'ask'; sessionId: string }) => callback(data)
      ipcRenderer.on('agent:sessionCreated', handler)
      return () => { ipcRenderer.removeListener('agent:sessionCreated', handler) }
    },

    onPermissionRequest: (callback: (request: PermissionRequestIPC) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, request: PermissionRequestIPC) => callback(request)
      ipcRenderer.on('agent:permissionRequest', handler)
      return () => { ipcRenderer.removeListener('agent:permissionRequest', handler) }
    },

    onAskUser: (callback: (request: AskUserRequestIPC) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, request: AskUserRequestIPC) => callback(request)
      ipcRenderer.on('agent:askUser', handler)
      return () => { ipcRenderer.removeListener('agent:askUser', handler) }
    },

    onAskUserTimeout: (callback: (data: { requestId: string; context: AgentContext }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { requestId: string; context: AgentContext }) => callback(data)
      ipcRenderer.on('agent:askUserTimeout', handler)
      return () => { ipcRenderer.removeListener('agent:askUserTimeout', handler) }
    },

    onPermissionTimeout: (callback: (data: { requestId: string; context: AgentContext }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { requestId: string; context: AgentContext }) => callback(data)
      ipcRenderer.on('agent:permissionTimeout', handler)
      return () => { ipcRenderer.removeListener('agent:permissionTimeout', handler) }
    },

    onSkillOutput: (callback: (state: SkillOutputState) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, state: SkillOutputState) => callback(state)
      ipcRenderer.on('skill:output', handler)
      return () => { ipcRenderer.removeListener('skill:output', handler) }
    },

    onNotification: (callback: (data: { type: string; message: string; title: string }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { type: string; message: string; title: string }) => callback(data)
      ipcRenderer.on('agent:notification', handler)
      return () => { ipcRenderer.removeListener('agent:notification', handler) }
    },
  },

  memory: {
    list: () => ipcRenderer.invoke('memory:list'),
    read: (filePath: string) => ipcRenderer.invoke('memory:read', filePath),
    write: (filePath: string, content: string) => ipcRenderer.invoke('memory:write', filePath, content),
    delete: (filePath: string) => ipcRenderer.invoke('memory:delete', filePath)
  },

  graph: {
    getData: () => ipcRenderer.invoke('graph:getData'),
    onFilesChanged: (callback: (data: { count: number; files: string[] }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { count: number; files: string[] }) => callback(data)
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
    onAvailable: (callback: (info: { version: string }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, info: { version: string }) => callback(info)
      ipcRenderer.on('update:available', handler)
      return () => { ipcRenderer.removeListener('update:available', handler) }
    },
    onDownloaded: (callback: () => void) => {
      const handler = (_event: Electron.IpcRendererEvent) => callback()
      ipcRenderer.on('update:downloaded', handler)
      return () => { ipcRenderer.removeListener('update:downloaded', handler) }
    }
  },

  onMainError: (callback: (error: { type: string; message: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, error: { type: string; message: string }) => callback(error)
    ipcRenderer.on('main:error', handler)
    return () => { ipcRenderer.removeListener('main:error', handler) }
  }
}

contextBridge.exposeInMainWorld('api', api)