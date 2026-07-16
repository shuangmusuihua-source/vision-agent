import { ipcMain, dialog, shell, app } from 'electron'
import { lstat, readFile, mkdir } from 'fs/promises'
import { extname, join } from 'path'
import { existsSync } from 'fs'
import { getMainWindow } from '../ipc-sender'
import {
  removeAuthorizedDirectory,
  addAuthorizedDirectory,
  getAuthorizedDirectories,
} from '../persistence/workspace-store'
import { getKnowledgeBaseDir } from '../persistence/store-core'
import { fileIndexService } from '../file-index-service'
import { findAuthorizedWorkspaceRoot, isPathAuthorized, sanitizeFileName } from '../path-validator'
import { atomicWriteTextFile } from '../atomic-write'
import { DOCUMENTS_DIR_NAME } from '../../shared/branding'
import { KNOWLEDGE_BASE_NAME, isReservedKnowledgeWorkspacePath } from '../../shared/workspace-paths'
import { addMarkdownToKnowledge } from '../knowledge-curation'
import { isAllowedExternalUrl } from '../navigation-policy'
import { readImageAsset, savePastedImageAsset } from '../image-asset-storage'
import type { IPCRequest } from '../../shared/ipc-types'

export function registerWorkspaceHandlers(
  pushSettingsToRenderer: () => void,
): void {
  ipcMain.handle('workspace:readFile', async (_event, filePath: string) => {
    if (!isPathAuthorized(filePath)) return { success: false, error: 'Path not authorized' }
    try { const content = await readFile(filePath, 'utf-8'); return { success: true, content } }
    catch (err) { return { success: false, error: (err as Error).message } }
  })

  ipcMain.handle('workspace:writeFile', async (_event, filePath: string, content: string) => {
    if (!isPathAuthorized(filePath)) return { success: false, error: 'Path not authorized' }
    try { await atomicWriteTextFile(filePath, content); return { success: true } }
    catch (err) { return { success: false, error: (err as Error).message } }
  })

  ipcMain.handle(
    'workspace:savePastedImage',
    async (_event, request: IPCRequest<'workspace:savePastedImage'>) => (
      savePastedImageAsset(request, isPathAuthorized)
    ),
  )

  ipcMain.handle(
    'workspace:readImageAsset',
    async (_event, request: IPCRequest<'workspace:readImageAsset'>) => (
      readImageAsset(request, isPathAuthorized)
    ),
  )

  ipcMain.handle('workspace:addToKnowledge', async (_event, request: { sourcePath: string; sessionId?: string }) => {
    if (!isPathAuthorized(request.sourcePath)) {
      return { success: false, error: '源文件路径未授权' }
    }
    return addMarkdownToKnowledge({
      sourcePath: request.sourcePath,
      knowledgeDir: getKnowledgeBaseDir(),
      sessionId: request.sessionId,
    })
  })

  ipcMain.handle('workspace:createWorkspace', async (_event, name: string) => {
    try {
      const safeName = sanitizeFileName(name.trim())
      if (!safeName || safeName !== name.trim()) return null
      if (safeName === KNOWLEDGE_BASE_NAME) return null
      const docsDir = join(app.getPath('documents'), DOCUMENTS_DIR_NAME)
      if (!existsSync(docsDir)) await mkdir(docsDir, { recursive: true })
      const dirPath = join(docsDir, safeName)
      if (existsSync(dirPath)) return null
      await mkdir(dirPath, { recursive: true })
      addAuthorizedDirectory(dirPath)
      try {
        await fileIndexService.init(getAuthorizedDirectories())
      } catch (error) {
        console.error('[workspace:createWorkspace] index refresh failed:', error)
      }
      pushSettingsToRenderer()
      return dirPath
    } catch (err) { console.error('Failed to create workspace:', err); return null }
  })

  ipcMain.handle('workspace:deleteWorkspace', async (_event, dirPath: string) => {
    const registeredRoot = findAuthorizedWorkspaceRoot(dirPath)
    if (!registeredRoot) {
      return { success: false, error: 'Only a registered workspace root can be deleted' }
    }
    if (isReservedKnowledgeWorkspacePath(dirPath, [getKnowledgeBaseDir()])) {
      return { success: false, error: 'Cannot delete system workspace' }
    }
    try {
      await shell.trashItem(registeredRoot)
      removeAuthorizedDirectory(registeredRoot)
      try {
        await fileIndexService.init(getAuthorizedDirectories())
      } catch (error) {
        console.error('[workspace:deleteWorkspace] index refresh failed:', error)
      }
      pushSettingsToRenderer()
      return { success: true }
    } catch (err) { return { success: false, error: (err as Error).message } }
  })

  ipcMain.handle('workspace:listMarkdownFiles', async (_event, dirPath: string) => {
    if (!isPathAuthorized(dirPath)) return []
    try { return await fileIndexService.listMarkdownFilesUnder(dirPath) }
    catch (e) { console.error('[workspace:listMarkdownFiles] failed:', dirPath, e); return [] }
  })

  ipcMain.handle('workspace:openInBrowser', async (_event, filePath: string) => {
    if (!isPathAuthorized(filePath)) return
    if (!['.html', '.htm'].includes(extname(filePath).toLowerCase())) return
    const stat = await lstat(filePath).catch(() => null)
    if (!stat?.isFile()) return
    await shell.openPath(filePath)
  })

  ipcMain.handle('workspace:openExternalUrl', async (_event, url: string) => {
    if (!isAllowedExternalUrl(url)) return { success: false }
    await shell.openExternal(url)
    return { success: true }
  })

  ipcMain.handle('workspace:previewArtifact', async (_event, options: { fileName: string; content: string }) => {
    const safeName = sanitizeFileName(options.fileName)
    if (!safeName) return { success: false, error: 'Invalid file name' }
    if (!['.html', '.htm'].includes(extname(safeName).toLowerCase())) {
      return { success: false, error: 'Only HTML previews are supported' }
    }
    const tmpDir = join(app.getPath('temp'), 'sumi-preview')
    await mkdir(tmpDir, { recursive: true })
    const filePath = join(tmpDir, safeName)
    if (!filePath.startsWith(tmpDir)) return { success: false, error: 'Path traversal detected' }
    await atomicWriteTextFile(filePath, options.content)
    await shell.openPath(filePath)
    return { success: true, filePath }
  })

  ipcMain.handle('workspace:saveArtifact', async (_event, options: { fileName: string; content: string; defaultPath?: string }) => {
    const window = getMainWindow()
    if (!window) return { success: false }
    const { canceled, filePath } = await dialog.showSaveDialog(window, {
      defaultPath: options.defaultPath ? join(options.defaultPath, options.fileName) : options.fileName,
      filters: [{ name: 'HTML', extensions: ['html'] }],
    })
    if (canceled || !filePath) return { success: false }
    await atomicWriteTextFile(filePath, options.content)
    return { success: true, filePath }
  })

  ipcMain.handle('workspace:knowledgeDir', () => getKnowledgeBaseDir())

}
