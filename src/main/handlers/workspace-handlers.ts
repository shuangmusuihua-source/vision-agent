import { ipcMain, dialog, shell, app } from 'electron'
import { readFile, writeFile, mkdir, unlink, rename, rm } from 'fs/promises'
import { join, extname, basename, dirname } from 'path'
import { existsSync } from 'fs'
import { getMainWindow } from '../ipc-sender'
import {
  removeAuthorizedDirectory,
  getAuthorizedDirectories,
  getKnowledgeBaseDir,
} from '../store'
import { fileIndexService } from '../file-index-service'
import { isPathAuthorized, sanitizeFileName } from '../path-validator'
import { atomicWriteTextFile } from '../atomic-write'
import type { WorkspaceDigest } from '../../shared/types'
import { DOCUMENTS_DIR_NAME } from '../../shared/branding'
import { KNOWLEDGE_BASE_NAME, isReservedKnowledgeWorkspacePath } from '../../shared/workspace-paths'

export function registerWorkspaceHandlers(
  scanDirectory: (dir: string) => Promise<import('../../shared/types').FileEntry[]>,
  listMarkdownFiles: (dir: string) => Promise<{ label: string; path: string }[]>,
  pushSettingsToRenderer: () => void,
  getSessionOverview?: (workspaceDir: string) => Promise<WorkspaceDigest | null>,
): void {
  ipcMain.handle('workspace:listFiles', async (_event, dirPath: string) => {
    if (!isPathAuthorized(dirPath)) return []
    try { return await scanDirectory(dirPath) }
    catch (e) { console.error('[workspace:listFiles] failed:', dirPath, e); return [] }
  })

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

  ipcMain.handle('workspace:deleteFile', async (_event, filePath: string) => {
    if (!isPathAuthorized(filePath)) return { success: false, error: 'Path not authorized' }
    try { await unlink(filePath); return { success: true } }
    catch (err) { return { success: false, error: (err as Error).message } }
  })

  ipcMain.handle('workspace:renameFile', async (_event, filePath: string, newName: string) => {
    if (!isPathAuthorized(filePath)) return { success: false, error: 'Path not authorized' }
    try {
      const safeName = sanitizeFileName(newName.trim())
      if (!safeName) return { success: false, error: 'Invalid file name' }
      const dir = dirname(filePath)
      const destPath = join(dir, safeName)
      if (!isPathAuthorized(destPath)) return { success: false, error: 'Path not authorized' }
      if (existsSync(destPath)) return { success: false, error: '同名文件已存在' }
      await rename(filePath, destPath)
      return { success: true, newPath: destPath }
    } catch (err) { return { success: false, error: (err as Error).message } }
  })

  ipcMain.handle('workspace:moveFile', async (_event, sourcePath: string, targetDir: string) => {
    if (!isPathAuthorized(sourcePath) || !isPathAuthorized(targetDir)) return { success: false, error: 'Path not authorized' }
    try {
      const fileName = basename(sourcePath)
      const destPath = join(targetDir, fileName)
      if (existsSync(destPath)) return { success: false, error: '目标目录已存在同名文件' }
      await rename(sourcePath, destPath)
      return { success: true, newPath: destPath }
    } catch (err) { return { success: false, error: (err as Error).message } }
  })

  ipcMain.handle('workspace:openDirectoryDialog', async () => {
    try {
      const window = getMainWindow()
      if (!window) return null
      const result = await dialog.showOpenDialog(window, { properties: ['openDirectory', 'createDirectory'] })
      if (result.canceled) return null
      return result.filePaths[0]
    } catch (err) { console.error('Failed to open directory dialog:', err); return null }
  })

  ipcMain.handle('workspace:newDirectoryDialog', async () => {
    try {
      const window = getMainWindow()
      if (!window) return null
      const result = await dialog.showSaveDialog(window, { title: '新建工作区', buttonLabel: '创建', properties: ['createDirectory'] })
      if (result.canceled || !result.filePath) return null
      await mkdir(result.filePath, { recursive: true })
      return result.filePath
    } catch (err) { console.error('Failed to create new directory:', err); return null }
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
      const dirs = getAuthorizedDirectories()
      if (dirs.length > 0) await fileIndexService.init(dirs[0])
      else fileIndexService.destroyWorkspaceIndex()
      pushSettingsToRenderer()
      return { success: true }
    } catch (err) { return { success: false, error: (err as Error).message } }
  })

  ipcMain.handle('workspace:createFile', async (_event, dirPath: string, fileName: string) => {
    if (!isPathAuthorized(dirPath)) return { success: false, error: 'Path not authorized' }
    try {
      let name = sanitizeFileName(fileName.trim())
      if (!name) return { success: false, error: '文件名不能为空' }
      if (!extname(name)) name += '.md'
      const filePath = join(dirPath, name)
      if (existsSync(filePath)) return { success: false, error: '文件已存在' }
      await writeFile(filePath, '', 'utf-8')
      return { success: true, path: filePath }
    } catch (err) { return { success: false, error: (err as Error).message } }
  })

  ipcMain.handle('workspace:createDir', async (_event, parentPath: string, dirName: string) => {
    if (!isPathAuthorized(parentPath)) return { success: false, error: 'Path not authorized' }
    try {
      const name = sanitizeFileName(dirName.trim())
      if (!name) return { success: false, error: '名称不能为空' }
      const dirPath = join(parentPath, name)
      if (existsSync(dirPath)) return { success: false, error: '目录已存在' }
      await mkdir(dirPath, { recursive: true })
      return { success: true, path: dirPath }
    } catch (err) { return { success: false, error: (err as Error).message } }
  })

  ipcMain.handle('workspace:renameEntry', async (_event, oldPath: string, newName: string) => {
    if (!isPathAuthorized(oldPath)) return { success: false, error: 'Path not authorized' }
    try {
      const name = sanitizeFileName(newName.trim())
      if (!name) return { success: false, error: '名称不能为空' }
      const parentDir = dirname(oldPath)
      const newPath = join(parentDir, name)
      if (existsSync(newPath)) return { success: false, error: '同名文件或目录已存在' }
      await rename(oldPath, newPath)
      return { success: true, path: newPath }
    } catch (err) { return { success: false, error: (err as Error).message } }
  })

  ipcMain.handle('workspace:deleteDir', async (_event, dirPath: string) => {
    if (!isPathAuthorized(dirPath)) return { success: false, error: 'Path not authorized' }
    try { await rm(dirPath, { recursive: true, force: true }); return { success: true } }
    catch (err) { return { success: false, error: (err as Error).message } }
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

  ipcMain.handle('workspace:getSessionOverview', async (_event, workspaceDir: string) => {
    if (!getSessionOverview) return null
    try { return await getSessionOverview(workspaceDir) }
    catch (e) { console.error('[workspace:getSessionOverview] failed:', e); return null }
  })
}
