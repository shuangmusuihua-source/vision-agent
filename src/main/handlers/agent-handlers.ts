import { ipcMain, dialog } from 'electron'
import { getMainWindow } from '../ipc-sender'
import { sendMessage, getSessionList, resolvePermission, resolveAskUser, listSdkSessions, loadSdkSessionMessages, abortActiveQuery } from '../agent-manager'
import type { AgentContext } from '../../shared/types'

export function registerAgentHandlers(): void {
  ipcMain.handle('agent:sendMessage', async (_event, prompt: string, sessionId?: string, activeFilePath?: string, skillId?: string, context?: AgentContext) => {
    const window = getMainWindow()
    if (!window) throw new Error('No main window')
    sendMessage(window, prompt, sessionId, activeFilePath, context || 'editor', skillId || null)
    return { started: true }
  })

  ipcMain.handle('agent:getSessionList', () => getSessionList())

  ipcMain.handle('agent:permissionResponse', (_event, requestId: string, behavior: 'allow' | 'deny') => {
    resolvePermission(requestId, behavior)
    return { success: true }
  })

  ipcMain.handle('agent:respondAskUser', (_event, requestId: string, answer: string) => {
    resolveAskUser(requestId, answer)
    return { success: true }
  })

  ipcMain.handle('agent:listSdkSessions', async () => await listSdkSessions())

  ipcMain.handle('agent:loadSessionMessages', async (_event, sessionId: string) => await loadSdkSessionMessages(sessionId))

  ipcMain.handle('agent:abort', (_event, context?: AgentContext) => {
    abortActiveQuery(context)
    return { success: true }
  })

  ipcMain.handle('agent:selectFolder', async () => {
    const window = getMainWindow()
    if (!window) return { canceled: true, filePaths: [] }
    return await dialog.showOpenDialog(window, { properties: ['openDirectory'] })
  })

  ipcMain.handle('workspace:selectFiles', async () => {
    const window = getMainWindow()
    if (!window) return { canceled: true, filePaths: [] }
    return await dialog.showOpenDialog(window, {
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'All Supported', extensions: ['txt', 'md', 'json', 'csv', 'xml', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'log', 'env', 'sh', 'bash', 'zsh', 'py', 'js', 'ts', 'tsx', 'jsx', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'hpp', 'css', 'html', 'svg', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'pdf'] },
        { name: 'Text', extensions: ['txt', 'md', 'json', 'csv', 'xml', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'log', 'env', 'sh', 'bash', 'zsh', 'py', 'js', 'ts', 'tsx', 'jsx', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'hpp', 'css', 'html', 'svg'] },
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] },
        { name: 'PDF', extensions: ['pdf'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    })
  })
}
