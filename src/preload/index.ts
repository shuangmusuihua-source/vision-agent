import { contextBridge, ipcRenderer } from 'electron'

const api = {
  ping: (): Promise<string> => ipcRenderer.invoke('ping'),

  workspace: {
    listFiles: (dirPath: string) => ipcRenderer.invoke('workspace:listFiles', dirPath),
    readFile: (filePath: string) => ipcRenderer.invoke('workspace:readFile', filePath),
    writeFile: (filePath: string, content: string) =>
      ipcRenderer.invoke('workspace:writeFile', filePath, content),
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
    removeDirectory: (dir: string) => ipcRenderer.invoke('settings:removeDirectory', dir)
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
    }
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