import { ipcMain, dialog, shell, app } from 'electron'
import { readFile, mkdir, rm } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'
import { getMainWindow } from '../ipc-sender'
import {
  removeAuthorizedDirectory,
  getAuthorizedDirectories,
} from '../persistence/workspace-store'
import { getKnowledgeBaseDir } from '../persistence/store-core'
import { fileIndexService } from '../file-index-service'
import { isPathAuthorized, sanitizeFileName } from '../path-validator'
import { atomicWriteTextFile } from '../atomic-write'
import { DOCUMENTS_DIR_NAME } from '../../shared/branding'
import { KNOWLEDGE_BASE_NAME, isReservedKnowledgeWorkspacePath } from '../../shared/workspace-paths'
import { addMarkdownToKnowledge } from '../knowledge-curation'

export function registerWorkspaceHandlers(
  listMarkdownFiles: (dir: string) => Promise<{ label: string; path: string }[]>,
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
      return dirPath
    } catch (err) { console.error('Failed to create workspace:', err); return null }
  })

  ipcMain.handle('workspace:deleteWorkspace', async (_event, dirPath: string) => {
    if (!isPathAuthorized(dirPath)) return { success: false, error: 'Path not authorized' }
    if (isReservedKnowledgeWorkspacePath(dirPath, [getKnowledgeBaseDir()])) {
      return { success: false, error: 'Cannot delete system workspace' }
    }
    try {
      await rm(dirPath, { recursive: true, force: true })
      removeAuthorizedDirectory(dirPath)
      await fileIndexService.init(getAuthorizedDirectories())
      pushSettingsToRenderer()
      return { success: true }
    } catch (err) { return { success: false, error: (err as Error).message } }
  })

  ipcMain.handle('workspace:listMarkdownFiles', async (_event, dirPath: string) => {
    if (!isPathAuthorized(dirPath)) return []
    try { return await listMarkdownFiles(dirPath) }
    catch (e) { console.error('[workspace:listMarkdownFiles] failed:', dirPath, e); return [] }
  })

  ipcMain.handle('workspace:openInBrowser', async (_event, filePath: string) => {
    if (!isPathAuthorized(filePath)) return
    await shell.openPath(filePath)
  })

  ipcMain.handle('workspace:previewArtifact', async (_event, options: { fileName: string; content: string }) => {
    const safeName = sanitizeFileName(options.fileName)
    if (!safeName) return { success: false, error: 'Invalid file name' }
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
