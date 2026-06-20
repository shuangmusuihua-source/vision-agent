import { ipcMain, dialog } from 'electron'
import { getMainWindow } from '../ipc-sender'
import { sendMessage, resolvePermission, resolveAskUser, listSdkSessions, loadSdkSessionMessages, loadSdkSessionMessagesPaginated, renameSdkSession, abortActiveQuery, deleteSdkSession, forkSdkSession } from '../agent-manager'
import { getSessionRecords, updateSessionRecord, removeSessionRecord, getSessionArtifactOutputs, recordSessionArtifactFromTool } from '../store'
import type { AgentContext } from '../../shared/types'
import type { IPCRequest } from '../../shared/ipc-types'

type AgentSendMessageRequest = IPCRequest<'agent:sendMessage'>
type AgentPermissionResponseRequest = IPCRequest<'agent:permissionResponse'>
type AgentRespondAskUserRequest = IPCRequest<'agent:respondAskUser'>
type AgentLoadSessionMessagesRequest = IPCRequest<'agent:loadSessionMessages'>
type AgentLoadSessionMessagesPaginatedRequest = IPCRequest<'agent:loadSessionMessagesPaginated'>
type AgentRenameSessionRequest = IPCRequest<'agent:renameSession'>
type AgentUpdateSessionRecordRequest = IPCRequest<'agent:updateSessionRecord'>
type AgentRemoveSessionRecordRequest = IPCRequest<'agent:removeSessionRecord'>
type AgentDeleteSessionRequest = IPCRequest<'agent:deleteSession'>
type AgentGetSessionOutputsRequest = IPCRequest<'agent:getSessionOutputs'>
type AgentSetPermissionModeRequest = IPCRequest<'agent:setPermissionMode'>
type AgentForkSessionRequest = IPCRequest<'agent:forkSession'>

function isObjectRequest<T extends object>(value: T | string | undefined): value is T {
  return typeof value === 'object' && value !== null
}

function requireArg<T>(value: T | undefined, name: string): T {
  if (value === undefined) throw new Error(`Missing IPC argument: ${name}`)
  return value
}

function normalizeSendMessageRequest(
  requestOrPrompt: AgentSendMessageRequest | string,
  sessionId?: string,
  activeFilePath?: string,
  skillId?: string,
  context?: AgentContext,
  workspacePath?: string,
  title?: string,
  clientSessionKey?: string
): AgentSendMessageRequest {
  if (typeof requestOrPrompt === 'object' && requestOrPrompt !== null) {
    return requestOrPrompt
  }
  return {
    prompt: requestOrPrompt,
    sessionId,
    activeFilePath,
    skillId,
    context,
    workspacePath,
    title,
    clientSessionKey,
  }
}

export function registerAgentHandlers(): void {
  ipcMain.handle('agent:sendMessage', async (_event, requestOrPrompt: AgentSendMessageRequest | string, sessionId?: string, activeFilePath?: string, skillId?: string, context?: AgentContext, workspacePath?: string, title?: string, clientSessionKey?: string) => {
    const window = getMainWindow()
    if (!window) throw new Error('No main window')
    const request = normalizeSendMessageRequest(
      requestOrPrompt,
      sessionId,
      activeFilePath,
      skillId,
      context,
      workspacePath,
      title,
      clientSessionKey
    )
    sendMessage(window, request.prompt, request.sessionId, request.activeFilePath, request.context || 'editor', request.skillId || null, request.workspacePath, request.clientSessionKey)
    return { started: true }
  })

  ipcMain.handle('agent:permissionResponse', (_event, requestOrId: AgentPermissionResponseRequest | string, behavior?: 'allow' | 'deny', options?: AgentPermissionResponseRequest['options']) => {
    const request: AgentPermissionResponseRequest = isObjectRequest(requestOrId)
      ? requestOrId
      : { requestId: requestOrId, behavior: requireArg(behavior, 'behavior'), options }
    resolvePermission(request.requestId, request.behavior, request.options as Parameters<typeof resolvePermission>[2])
    return { success: true }
  })

  ipcMain.handle('agent:respondAskUser', (_event, requestOrId: AgentRespondAskUserRequest | string, answers?: Record<string, string>) => {
    const request: AgentRespondAskUserRequest = isObjectRequest(requestOrId)
      ? requestOrId
      : { requestId: requestOrId, answers: requireArg(answers, 'answers') }
    resolveAskUser(request.requestId, request.answers)
    return { success: true }
  })

  ipcMain.handle('agent:listSdkSessions', async (_event, workspaceCwd?: string) => await listSdkSessions(workspaceCwd))

  ipcMain.handle('agent:loadSessionMessages', async (_event, requestOrId: AgentLoadSessionMessagesRequest | string, limit?: number, offset?: number) => {
    const request: AgentLoadSessionMessagesRequest = isObjectRequest(requestOrId)
      ? requestOrId
      : { sessionId: requestOrId, limit, offset }
    return await loadSdkSessionMessages(request.sessionId, request.limit, request.offset)
  })

  ipcMain.handle('agent:loadSessionMessagesPaginated', async (_event, requestOrId: AgentLoadSessionMessagesPaginatedRequest | string, limit?: number, offset?: number) => {
    const request: AgentLoadSessionMessagesPaginatedRequest = isObjectRequest(requestOrId)
      ? requestOrId
      : {
          sessionId: requestOrId,
          limit: requireArg(limit, 'limit'),
          offset: requireArg(offset, 'offset'),
        }
    return await loadSdkSessionMessagesPaginated(request.sessionId, request.limit, request.offset)
  })

  ipcMain.handle('agent:renameSession', async (_event, requestOrId: AgentRenameSessionRequest | string, title?: string) => {
    const request: AgentRenameSessionRequest = isObjectRequest(requestOrId)
      ? requestOrId
      : { sessionId: requestOrId, title: requireArg(title, 'title') }
    await renameSdkSession(request.sessionId, request.title)
    return { success: true }
  })

  ipcMain.handle('agent:updateSessionRecord', (_event, requestOrId: AgentUpdateSessionRecordRequest | string, patch?: Record<string, unknown>) => {
    const request: AgentUpdateSessionRecordRequest = isObjectRequest(requestOrId)
      ? requestOrId
      : { sessionId: requestOrId, patch: requireArg(patch, 'patch') }
    updateSessionRecord(request.sessionId, request.patch as any)
    return { success: true }
  })

  ipcMain.handle('agent:removeSessionRecord', (_event, requestOrId: AgentRemoveSessionRecordRequest | string) => {
    const request: AgentRemoveSessionRecordRequest = isObjectRequest(requestOrId)
      ? requestOrId
      : { sessionId: requestOrId }
    removeSessionRecord(request.sessionId)
    return { success: true }
  })

  ipcMain.handle('agent:abort', (_event, contextOrSessionId?: string) => {
    // Supports both AgentContext ('editor'|'ask') and sessionId for parallel streaming
    abortActiveQuery(contextOrSessionId)
    return { success: true }
  })

  ipcMain.handle('agent:deleteSession', async (_event, requestOrId: AgentDeleteSessionRequest | string) => {
    const request: AgentDeleteSessionRequest = isObjectRequest(requestOrId)
      ? requestOrId
      : { sessionId: requestOrId }
    // Abort any running query for this session before deletion — prevents
    // resource leaks (orphaned subprocess, pending permissions) and avoids
    // the SDK recreating the session file from a still-running query.
    abortActiveQuery(request.sessionId)
    await deleteSdkSession(request.sessionId)
    return { success: true }
  })

  ipcMain.handle('agent:getSessionOutputs', async (_event, requestOrId: AgentGetSessionOutputsRequest | string) => {
    const request: AgentGetSessionOutputsRequest = isObjectRequest(requestOrId)
      ? requestOrId
      : { sessionId: requestOrId }
    try {
      // Find session record to get workspacePath
      const records = getSessionRecords()
      const record = records.find(r => r.id === request.sessionId || r.sdkSessionId === request.sessionId)
      const workspacePath = record?.workspacePath
      const appSessionId = record?.id || request.sessionId

      // Backfill legacy sessions from SDK history, then read the app-owned
      // artifact registry as the source of truth for overview display.
      const messages = await loadSdkSessionMessages(request.sessionId)
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

  ipcMain.handle('agent:setPermissionMode', async (_event, requestOrContext: AgentSetPermissionModeRequest | AgentContext, mode?: string) => {
    const request: AgentSetPermissionModeRequest = isObjectRequest(requestOrContext)
      ? requestOrContext
      : { context: requestOrContext, mode: requireArg(mode, 'mode') }
    // setPermissionMode requires access to the active Query object
    // This is a placeholder — full implementation needs query-runner integration
    console.warn('[AgentHandlers] setPermissionMode: not yet fully integrated', request)
    return { success: true }
  })

  ipcMain.handle('agent:forkSession', async (_event, requestOrId: AgentForkSessionRequest | string, options?: AgentForkSessionRequest['options']) => {
    const request: AgentForkSessionRequest = isObjectRequest(requestOrId)
      ? requestOrId
      : { sessionId: requestOrId, options }
    try {
      const result = await forkSdkSession(request.sessionId, request.options)
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
