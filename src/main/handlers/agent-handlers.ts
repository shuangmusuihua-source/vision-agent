import { ipcMain, dialog } from 'electron'
import { getMainWindow } from '../ipc-sender'
import { sendMessage, resolvePermission, resolveAskUser, listSdkSessions, loadSdkSessionMessages, loadSdkSessionMessagesPaginated, renameSdkSession, abortActiveQuery, deleteSdkSession } from '../agent-manager'
import { getSessionRecords, updateSessionRecord, removeSessionRecord } from '../store'
import { access } from 'fs/promises'
import type { SessionOutputEntry } from '../../shared/types'
import type { AgentContext } from '../../shared/types'

export function registerAgentHandlers(): void {
  ipcMain.handle('agent:sendMessage', async (_event, prompt: string, sessionId?: string, activeFilePath?: string, skillId?: string, context?: AgentContext, workspacePath?: string) => {
    const window = getMainWindow()
    if (!window) throw new Error('No main window')
    sendMessage(window, prompt, sessionId, activeFilePath, context || 'editor', skillId || null, workspacePath)
    return { started: true }
  })

  ipcMain.handle('agent:permissionResponse', (_event, requestId: string, behavior: 'allow' | 'deny') => {
    resolvePermission(requestId, behavior)
    return { success: true }
  })

  ipcMain.handle('agent:respondAskUser', (_event, requestId: string, answer: string) => {
    resolveAskUser(requestId, answer)
    return { success: true }
  })

  ipcMain.handle('agent:listSdkSessions', async (_event, workspaceCwd?: string) => await listSdkSessions(workspaceCwd))

  ipcMain.handle('agent:loadSessionMessages', async (_event, sessionId: string, limit?: number, offset?: number) => await loadSdkSessionMessages(sessionId, limit, offset))

  ipcMain.handle('agent:loadSessionMessagesPaginated', async (_event, sessionId: string, limit: number, offset: number) => await loadSdkSessionMessagesPaginated(sessionId, limit, offset))

  ipcMain.handle('agent:renameSession', async (_event, sessionId: string, title: string) => {
    await renameSdkSession(sessionId, title)
    return { success: true }
  })

  ipcMain.handle('agent:updateSessionRecord', (_event, sessionId: string, patch: Record<string, unknown>) => {
    updateSessionRecord(sessionId, patch as any)
    return { success: true }
  })

  ipcMain.handle('agent:removeSessionRecord', (_event, sessionId: string) => {
    removeSessionRecord(sessionId)
    return { success: true }
  })

  ipcMain.handle('agent:abort', (_event, contextOrSessionId?: string) => {
    // Supports both AgentContext ('editor'|'ask') and sessionId for parallel streaming
    abortActiveQuery(contextOrSessionId)
    return { success: true }
  })

  ipcMain.handle('agent:deleteSession', async (_event, sessionId: string) => {
    // Abort any running query for this session before deletion — prevents
    // resource leaks (orphaned subprocess, pending permissions) and avoids
    // the SDK recreating the session file from a still-running query.
    abortActiveQuery(sessionId)
    await deleteSdkSession(sessionId)
    return { success: true }
  })

  ipcMain.handle('agent:getSessionOutputs', async (_event, sessionId: string) => {
    try {
      // Find session record to get workspacePath
      const records = getSessionRecords()
      const record = records.find(r => r.id === sessionId)
      const workspacePath = record?.workspacePath

      // Load all messages for this session
      const messages = await loadSdkSessionMessages(sessionId)
      const files: SessionOutputEntry[] = []
      const seen = new Set<string>()

      for (const msg of messages) {
        const content = (msg as Record<string, unknown>).message as Record<string, unknown> | undefined
        const contentBlocks = content?.content as Array<Record<string, unknown>> | undefined
        if (!contentBlocks) continue

        for (const block of contentBlocks) {
          if (block.type !== 'tool_use') continue
          const name = block.name as string
          if (name !== 'Write' && name !== 'Edit') continue
          const input = block.input as Record<string, unknown> | undefined
          const filePath = input?.file_path as string | undefined
          if (!filePath || seen.has(filePath)) continue

          // Async file existence check to avoid blocking the main process
          try {
            await access(filePath)
          } catch {
            continue
          }

          seen.add(filePath)
          const fileName = filePath.split('/').pop() || filePath
          const ext = fileName.split('.').pop()?.toLowerCase()
          const fileType = (ext === 'html' || ext === 'htm') ? 'html'
            : ext === 'svg' ? 'svg'
            : ext === 'json' ? 'json'
            : ext === 'png' || ext === 'jpg' || ext === 'jpeg' ? 'png'
            : 'md'
          const isSkillOutput = fileType === 'html' || fileType === 'svg'

          files.push({
            fileName,
            filePath,
            fileType: fileType as SessionOutputEntry['fileType'],
            category: isSkillOutput ? 'skill_output' : 'document',
            source: name,
            createdAt: Date.now(),
          })
        }
      }

      return { sessionId, workspacePath: workspacePath || '', files }
    } catch (e) {
      console.error('[agent:getSessionOutputs] failed:', e)
      return null
    }
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
