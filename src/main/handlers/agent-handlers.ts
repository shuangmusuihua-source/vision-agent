import { ipcMain, dialog } from 'electron'
import { getMainWindow } from '../ipc-sender'
import { sendMessage, resolvePermission, resolveAskUser, listSdkSessions, loadSdkSessionMessages, loadSdkSessionMessagesPaginated, renameSdkSession, abortActiveQuery, deleteSdkSession, forkSdkSession } from '../agent-manager'
import { getSessionRecords, updateSessionRecord, removeSessionRecord, getSessionArtifactOutputs, recordSessionArtifactFromTool } from '../store'
import type { AgentContext } from '../../shared/types'

export function registerAgentHandlers(): void {
  ipcMain.handle('agent:sendMessage', async (_event, prompt: string, sessionId?: string, activeFilePath?: string, skillId?: string, context?: AgentContext, workspacePath?: string, _title?: string, clientSessionKey?: string) => {
    const window = getMainWindow()
    if (!window) throw new Error('No main window')
    sendMessage(window, prompt, sessionId, activeFilePath, context || 'editor', skillId || null, workspacePath, clientSessionKey)
    return { started: true }
  })

  ipcMain.handle('agent:permissionResponse', (_event, requestId: string, behavior: 'allow' | 'deny', options?: { updatedPermissions?: Array<Record<string, unknown>>; decisionClassification?: 'user_temporary' | 'user_permanent' | 'user_reject' }) => {
    resolvePermission(requestId, behavior, options as Parameters<typeof resolvePermission>[2])
    return { success: true }
  })

  ipcMain.handle('agent:respondAskUser', (_event, requestId: string, answers: Record<string, string>) => {
    resolveAskUser(requestId, answers)
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
      const record = records.find(r => r.id === sessionId || r.sdkSessionId === sessionId)
      const workspacePath = record?.workspacePath
      const appSessionId = record?.id || sessionId

      // Backfill legacy sessions from SDK history, then read the app-owned
      // artifact registry as the source of truth for overview display.
      const messages = await loadSdkSessionMessages(sessionId)
      for (const msg of messages) {
        const content = (msg as Record<string, unknown>).message as Record<string, unknown> | undefined
        const contentBlocks = content?.content as Array<Record<string, unknown>> | undefined
        if (!contentBlocks) continue

        for (const block of contentBlocks) {
          if (block.type !== 'tool_use') continue
          const name = block.name as string
          if (name !== 'Write' && name !== 'Edit') continue
          recordSessionArtifactFromTool({
            sessionId: appSessionId,
            sdkSessionId: record?.sdkSessionId,
            workspacePath,
            toolName: name,
            toolInput: block.input,
          })
        }
      }

      const files = getSessionArtifactOutputs(appSessionId)
      return { sessionId: appSessionId, workspacePath: workspacePath || '', files }
    } catch (e) {
      console.error('[agent:getSessionOutputs] failed:', e)
      return null
    }
  })

  ipcMain.handle('agent:setPermissionMode', async (_event, context: AgentContext, mode: string) => {
    // setPermissionMode requires access to the active Query object
    // This is a placeholder — full implementation needs query-runner integration
    console.warn('[AgentHandlers] setPermissionMode: not yet fully integrated')
    return { success: true }
  })

  ipcMain.handle('agent:forkSession', async (_event, sessionId: string, options?: { upToMessageId?: string; title?: string }) => {
    try {
      const result = await forkSdkSession(sessionId, options)
      if (result) return { success: true, sessionId: result.sessionId }
      return { success: false, error: 'Fork failed' }
    } catch (err) {
      return { success: false, error: (err as Error).message }
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
