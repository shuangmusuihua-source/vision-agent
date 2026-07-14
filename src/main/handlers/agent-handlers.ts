import { ipcMain, dialog, shell } from 'electron'
import { getMainWindow } from '../ipc-sender'
import { sendMessage, abortActiveQuery, abortActiveQueryAndWait, setPermissionMode } from '../query-runner'
import { resolvePermission, resolveAskUser } from '../session-runtime'
import { listSdkSessions, loadSdkSessionMessagesPaginated, renameSdkSession, deleteSdkSession } from '../session-store'
import { getSessionRecords, getSessionRecordById, updateSessionRecord, removeSessionRecord } from '../persistence/workspace-store'
import { getSessionFileOutputs } from '../session-file-catalog'
import type { IPCRequest } from '../../shared/ipc-types'
import { isAgentApprovalMode } from '../../shared/types'
import { removeSessionWorkingDirectory } from '../session-files'
import { createAttachmentPathGrant } from '../attachment-path-authorization'
import { removeSessionOutputMetadataEntry } from '../session-output-metadata'
import { isAuthorizedSessionWorkspace } from '../path-validator'
import { isSafeSdkSessionId, normalizeSessionPage } from '../session-request-policy'
import { extname } from 'path'

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
type AgentOpenSessionOutputRequest = IPCRequest<'agent:openSessionOutput'>
type AgentDeleteSessionOutputRequest = IPCRequest<'agent:deleteSessionOutput'>
type AgentSetPermissionModeRequest = IPCRequest<'agent:setPermissionMode'>
type AgentAbortRequest = IPCRequest<'agent:abort'>

export function registerAgentHandlers(): void {
  ipcMain.handle('agent:sendMessage', async (_event, request: AgentSendMessageRequest) => {
    const window = getMainWindow()
    if (!window) throw new Error('No main window')
    if (request.context !== undefined && request.context !== 'editor' && request.context !== 'ask') {
      throw new Error('Invalid agent context')
    }
    sendMessage(window, request.prompt, request.sessionId, request.activeFilePath, request.context || 'editor', request.skillId || null, request.workspacePath, request.clientSessionKey, request.title, request.approvalMode)
    return { started: true }
  })

  ipcMain.handle('agent:permissionResponse', (_event, request: AgentPermissionResponseRequest) => {
    resolvePermission(request.requestId, request.behavior, request.options as Parameters<typeof resolvePermission>[2])
    return { success: true }
  })

  ipcMain.handle('agent:respondAskUser', (_event, request: AgentRespondAskUserRequest) => {
    resolveAskUser(request.requestId, request.answers)
    return { success: true }
  })

  ipcMain.handle('agent:listSdkSessions', async (_event, request: AgentListSdkSessionsRequest) => {
    return await listSdkSessions(request.workspaceCwd)
  })

  ipcMain.handle('agent:loadSessionMessagesPaginated', async (_event, request: AgentLoadSessionMessagesPaginatedRequest) => {
    const record = getSessionRecordById(request.sessionId)
    if (!record?.sdkSessionId || !isSafeSdkSessionId(record.sdkSessionId)) {
      return { messages: [], offset: 0, limit: 0, hasMore: false }
    }
    const page = normalizeSessionPage(request.limit, request.offset)
    return await loadSdkSessionMessagesPaginated(record.sdkSessionId, page.limit, page.offset)
  })

  ipcMain.handle('agent:renameSession', async (_event, request: AgentRenameSessionRequest) => {
    await renameSdkSession(request.sessionId, request.title)
    return { success: true }
  })

  ipcMain.handle('agent:updateSessionRecord', (_event, request: AgentUpdateSessionRecordRequest) => {
    if (getSessionRecordById(request.sessionId)) {
      return { success: false, error: 'Existing session ownership cannot be replaced' }
    }
    const patch = request.patch
    if (patch.context !== 'editor'
      || typeof patch.workspacePath !== 'string'
      || !isAuthorizedSessionWorkspace(patch.workspacePath)) {
      return { success: false, error: 'Session workspace is not authorized' }
    }
    const now = Date.now()
    updateSessionRecord(request.sessionId, {
      title: typeof patch.title === 'string' ? patch.title.trim() : undefined,
      workspacePath: patch.workspacePath,
      context: 'editor',
      status: 'empty',
      createdAt: now,
      lastModified: now,
      messageCount: 0,
    })
    return { success: true }
  })

  ipcMain.handle('agent:removeSessionRecord', async (_event, request: AgentRemoveSessionRecordRequest) => {
    await abortActiveQueryAndWait(request.sessionId)
    const record = getSessionRecordById(request.sessionId)
    if (record) {
      await removeSessionWorkingDirectory(record.workspacePath, record.workingDirectory, record.context)
    }
    removeSessionRecord(request.sessionId)
    return { success: true }
  })

  ipcMain.handle('agent:abort', (_event, request: AgentAbortRequest) => {
    // Supports both AgentContext ('editor'|'ask') and sessionId for parallel streaming
    abortActiveQuery(request.contextOrSessionId)
    return { success: true }
  })

  ipcMain.handle('agent:deleteSession', async (_event, request: AgentDeleteSessionRequest) => {
    // Abort any running query for this session before deletion — prevents
    // resource leaks (orphaned subprocess, pending permissions) and avoids
    // the SDK recreating the session file from a still-running query.
    await abortActiveQueryAndWait(request.sessionId)
    await deleteSdkSession(request.sessionId)
    return { success: true }
  })

  ipcMain.handle('agent:getSessionOutputs', async (_event, request: AgentGetSessionOutputsRequest) => {
    try {
      // Find session record to get workspacePath
      const records = getSessionRecords()
      const record = records.find(r => r.id === request.sessionId || r.sdkSessionId === request.sessionId)
      const workspacePath = record?.workspacePath
      const appSessionId = record?.id || request.sessionId

      const files = await getSessionFileOutputs(appSessionId)
      return { sessionId: appSessionId, workspacePath: workspacePath || '', files }
    } catch (e) {
      console.error('[agent:getSessionOutputs] failed:', e)
      return null
    }
  })

  ipcMain.handle('agent:revealSessionOutput', async (_event, request: AgentRevealSessionOutputRequest) => {
    const record = getSessionRecordById(request.sessionId)
    if (!record?.workingDirectory) return { success: false, error: '会话文件目录不可用' }
    const output = (await getSessionFileOutputs(request.sessionId))
      .find((file) => file.filePath === request.filePath && file.availability === 'available')
    if (!output) return { success: false, error: '产物不存在或不属于当前会话' }
    shell.showItemInFolder(output.filePath)
    return { success: true }
  })

  ipcMain.handle('agent:openSessionOutput', async (_event, request: AgentOpenSessionOutputRequest) => {
    const record = getSessionRecordById(request.sessionId)
    if (!record?.workingDirectory) return { success: false, error: '会话文件目录不可用' }
    const output = (await getSessionFileOutputs(request.sessionId))
      .find((file) => file.filePath === request.filePath && file.availability === 'available')
    if (!output) return { success: false, error: '产物不存在或不属于当前会话' }
    const safeExtensions = new Set([
      '.html', '.htm', '.md', '.txt', '.pdf', '.csv', '.json', '.svg',
      '.png', '.jpg', '.jpeg', '.gif', '.webp', '.docx', '.pptx', '.xlsx',
    ])
    if (!safeExtensions.has(extname(output.filePath).toLowerCase())) {
      return { success: false, error: '不支持打开此文件类型' }
    }
    await shell.openPath(output.filePath)
    return { success: true }
  })

  ipcMain.handle('agent:deleteSessionOutput', async (_event, request: AgentDeleteSessionOutputRequest) => {
    const record = getSessionRecordById(request.sessionId)
    if (!record?.workingDirectory) return { success: false, error: '会话文件目录不可用' }
    const output = (await getSessionFileOutputs(request.sessionId))
      .find((file) => file.filePath === request.filePath && file.availability === 'available')
    if (!output || output.category !== 'skill_output') {
      return { success: false, error: '只能删除当前会话中的 Skill 产物' }
    }
    try {
      await shell.trashItem(output.filePath)
      await removeSessionOutputMetadataEntry(record.workingDirectory, output.filePath)
      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('agent:setPermissionMode', async (_event, request: AgentSetPermissionModeRequest) => {
    if (!isAgentApprovalMode(request.mode)) {
      return { success: false, error: `Unsupported approval mode: ${String(request.mode)}` }
    }

    try {
      const applied = await setPermissionMode(request.queryKey, request.mode === 'auto' ? 'auto' : 'default')
      if (!applied) {
        return { success: false, error: `No active agent run for session: ${request.queryKey}` }
      }
      return { success: true }
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
    const result = await dialog.showOpenDialog(window, {
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'All Supported', extensions: ['txt', 'md', 'json', 'csv', 'xml', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'log', 'env', 'sh', 'bash', 'zsh', 'py', 'js', 'ts', 'tsx', 'jsx', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'hpp', 'css', 'html', 'svg', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'pdf', 'docx', 'pptx', 'xlsx'] },
        { name: 'Text', extensions: ['txt', 'md', 'json', 'csv', 'xml', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'log', 'env', 'sh', 'bash', 'zsh', 'py', 'js', 'ts', 'tsx', 'jsx', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'hpp', 'css', 'html', 'svg'] },
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] },
        { name: 'Documents', extensions: ['pdf', 'docx', 'pptx', 'xlsx'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    })
    if (result.canceled) return result
    return {
      ...result,
      attachmentGrantId: createAttachmentPathGrant(result.filePaths),
    }
  })
}
