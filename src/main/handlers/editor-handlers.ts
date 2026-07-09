import { ipcMain } from 'electron'
import type { IPCRequest } from '../../shared/ipc-types'
import { inlineRewriteRunner } from '../inline-rewrite-runner'
import { isPathAuthorized } from '../path-validator'

type RewriteSelectionRequest = IPCRequest<'editor:rewriteSelection'>
type PrepareRewriteRequest = IPCRequest<'editor:prepareRewrite'>
type CancelRewriteRequest = IPCRequest<'editor:cancelRewrite'>

export function registerEditorHandlers(): void {
  ipcMain.handle('editor:prepareRewrite', (_event, request: PrepareRewriteRequest) => {
    if (!isPathAuthorized(request.filePath)) throw new Error('当前文件路径未授权')
    return { prepared: inlineRewriteRunner.prepare(request) }
  })

  ipcMain.handle('editor:rewriteSelection', async (_event, request: RewriteSelectionRequest) => {
    if (!isPathAuthorized(request.filePath)) throw new Error('当前文件路径未授权')
    return inlineRewriteRunner.rewrite(request)
  })

  ipcMain.handle('editor:cancelRewrite', (_event, request: CancelRewriteRequest) => ({
    cancelled: inlineRewriteRunner.cancel(request.requestId),
  }))
}
