import { contextBridge, ipcRenderer } from 'electron'

const api = {
  ping: (): Promise<string> => ipcRenderer.invoke('ping'),

  workspace: {
    listFiles: (dirPath: string) => ipcRenderer.invoke('workspace:listFiles', dirPath),
    readFile: (filePath: string) => ipcRenderer.invoke('workspace:readFile', filePath),
    writeFile: (filePath: string, content: string) =>
      ipcRenderer.invoke('workspace:writeFile', filePath, content),
    listMarkdownFiles: (dirPath: string) => ipcRenderer.invoke('workspace:listMarkdownFiles', dirPath),
    openDirectoryDialog: () => ipcRenderer.invoke('workspace:openDirectoryDialog')
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
    getTheme: () => ipcRenderer.invoke('settings:getTheme'),
    setTheme: (theme: 'light' | 'dark' | 'system') => ipcRenderer.invoke('settings:setTheme', theme)
  },

  agent: {
    sendMessage: (prompt: string, sessionId?: string) =>
      ipcRenderer.invoke('agent:sendMessage', prompt, sessionId),
    getSessionList: () => ipcRenderer.invoke('agent:getSessionList'),
    onMessage: (callback: (data: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data)
      ipcRenderer.on('agent:message', handler)
      return () => ipcRenderer.removeListener('agent:message', handler)
    },
    onSessionCreated: (callback: (sessionId: string) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, sessionId: string) =>
        callback(sessionId)
      ipcRenderer.on('agent:sessionCreated', handler)
      return () => ipcRenderer.removeListener('agent:sessionCreated', handler)
    },
    onComplete: (callback: (data: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data)
      ipcRenderer.on('agent:complete', handler)
      return () => ipcRenderer.removeListener('agent:complete', handler)
    },
    onError: (callback: (data: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data)
      ipcRenderer.on('agent:error', handler)
      return () => ipcRenderer.removeListener('agent:error', handler)
    },
    onPermissionRequest: (callback: (request: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, request: unknown) => callback(request)
      ipcRenderer.on('agent:permissionRequest', handler)
      return () => ipcRenderer.removeListener('agent:permissionRequest', handler)
    },
    onNotification: (callback: (data: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data)
      ipcRenderer.on('agent:notification', handler)
      return () => ipcRenderer.removeListener('agent:notification', handler)
    },
    respondPermission: (requestId: string, behavior: 'allow' | 'deny') =>
      ipcRenderer.invoke('agent:permissionResponse', requestId, behavior),
    listSdkSessions: () => ipcRenderer.invoke('agent:listSdkSessions'),
    loadSessionMessages: (sessionId: string) => ipcRenderer.invoke('agent:loadSessionMessages', sessionId)
  },

  memory: {
    list: () => ipcRenderer.invoke('memory:list'),
    read: (filePath: string) => ipcRenderer.invoke('memory:read', filePath),
    write: (filePath: string, content: string) => ipcRenderer.invoke('memory:write', filePath, content),
    delete: (filePath: string) => ipcRenderer.invoke('memory:delete', filePath)
  },

  graph: {
    getData: () => ipcRenderer.invoke('graph:getData')
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
      return () => ipcRenderer.removeListener('cron:taskCompleted', handler)
    }
  },

  skills: {
    list: () => ipcRenderer.invoke('skills:list')
  },

  search: {
    query: (keyword: string) => ipcRenderer.invoke('search:query', keyword)
  }
}

interface ModelProfile {
  id: string
  name: string
  apiKey: string
  apiProvider: 'anthropic' | 'bedrock' | 'vertex' | 'azure' | 'custom'
  baseUrl: string
  model: string
}

contextBridge.exposeInMainWorld('api', api)