import { ipcMain, dialog, shell, nativeTheme, app } from 'electron'
import { readFile, writeFile, readdir, mkdir, unlink, rename, rm } from 'fs/promises'
import { join, extname, relative, basename, dirname } from 'path'
import { existsSync } from 'fs'
import { getMainWindow } from './index'
import { sendMessage, getSessionList, resolvePermission, resolveAskUser, listSdkSessions, loadSdkSessionMessages, abortActiveQuery, setActiveSkillId } from './agent-manager'
import { registerTask, removeTask, listTasks, executeTaskById } from './cron-manager'
import { getBuiltinSkills } from './skills/builtin'
import { extractSemanticGraph, loadSemanticGraph, mergeGraphData, semanticDataToGraph } from './semantic-extractor'
import type { AgentContext, GraphNode, GraphEdge, GraphData, FileEntry } from '../shared/types'
import {
  getSettings,
  addProfile,
  updateProfile,
  removeProfile,
  setActiveProfile,
  addAuthorizedDirectory,
  removeAuthorizedDirectory,
  reorderAuthorizedDirectories,
  getAuthorizedDirectories,
  getKnowledgeBaseDir,
  getFixedDirectories,
  getTheme,
  setTheme,
  getApiKey,
  getBaseUrl,
} from './store'
import { getNotificationHistory } from './notification-manager'
import { fileIndexService } from './file-index-service'
import { isPathAuthorized, sanitizeFileName, addAuthorizedRoot } from './path-validator'

function pushSettingsToRenderer(): void {
  const window = getMainWindow()
  if (window && !window.isDestroyed()) {
    window.webContents.send('settings:changed', getSettings())
  }
}

// --- Workspace ---

async function scanDirectory(dirPath: string, maxDepth = 3, depth = 0): Promise<FileEntry[]> {
  if (depth >= maxDepth) return []
  const entries = await readdir(dirPath, { withFileTypes: true })
  const result: FileEntry[] = []
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const fullPath = join(dirPath, entry.name)
    if (entry.isDirectory()) {
      const children = await scanDirectory(fullPath, maxDepth, depth + 1)
      result.push({ name: entry.name, path: fullPath, isDirectory: true, children })
    } else if (extname(entry.name) === '.md') {
      result.push({ name: entry.name, path: fullPath, isDirectory: false })
    }
  }
  return result
}

async function listMarkdownFiles(dirPath: string): Promise<Array<{ label: string; path: string }>> {
  const results: Array<{ label: string; path: string }> = []
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const fullPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(fullPath)
      } else if (extname(entry.name) === '.md') {
        results.push({
          label: entry.name.replace(/\.md$/, ''),
          path: fullPath
        })
      }
    }
  }
  await walk(dirPath)
  return results
}

// --- Register all handlers ---

export function registerIpcHandlers(): void {
  // Ping
  ipcMain.handle('ping', () => 'pong')

  // --- Workspace ---
  ipcMain.handle('workspace:listFiles', async (_event, dirPath: string) => {
    if (!isPathAuthorized(dirPath)) return []
    try {
      return await scanDirectory(dirPath)
    } catch {
      return []
    }
  })

  ipcMain.handle('workspace:readFile', async (_event, filePath: string) => {
    if (!isPathAuthorized(filePath)) return { success: false, error: 'Path not authorized' }
    try {
      const content = await readFile(filePath, 'utf-8')
      return { success: true, content }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('workspace:writeFile', async (_event, filePath: string, content: string) => {
    if (!isPathAuthorized(filePath)) return { success: false, error: 'Path not authorized' }
    try {
      await writeFile(filePath, content, 'utf-8')
      return { success: true }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('workspace:deleteFile', async (_event, filePath: string) => {
    if (!isPathAuthorized(filePath)) return { success: false, error: 'Path not authorized' }
    try {
      await unlink(filePath)
      return { success: true }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('workspace:renameFile', async (_event, filePath: string, newName: string) => {
    if (!isPathAuthorized(filePath)) return { success: false, error: 'Path not authorized' }
    try {
      const dir = dirname(filePath)
      const destPath = join(dir, newName)
      if (existsSync(destPath)) return { success: false, error: '同名文件已存在' }
      await rename(filePath, destPath)
      return { success: true, newPath: destPath }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('workspace:moveFile', async (_event, sourcePath: string, targetDir: string) => {
    if (!isPathAuthorized(sourcePath) || !isPathAuthorized(targetDir)) return { success: false, error: 'Path not authorized' }
    try {
      const fileName = basename(sourcePath)
      const destPath = join(targetDir, fileName)
      if (existsSync(destPath)) return { success: false, error: '目标目录已存在同名文件' }
      await rename(sourcePath, destPath)
      return { success: true, newPath: destPath }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('workspace:openDirectoryDialog', async () => {
    try {
      const window = getMainWindow()
      if (!window) return null
      const result = await dialog.showOpenDialog(window, {
        properties: ['openDirectory', 'createDirectory']
      })
      if (result.canceled) return null
      return result.filePaths[0]
    } catch (err) {
      console.error('Failed to open directory dialog:', err)
      return null
    }
  })

  ipcMain.handle('workspace:newDirectoryDialog', async () => {
    try {
      const window = getMainWindow()
      if (!window) return null
      const result = await dialog.showSaveDialog(window, {
        title: '新建工作区',
        buttonLabel: '创建',
        properties: ['createDirectory']
      })
      if (result.canceled || !result.filePath) return null
      await mkdir(result.filePath, { recursive: true })
      return result.filePath
    } catch (err) {
      console.error('Failed to create new directory:', err)
      return null
    }
  })

  ipcMain.handle('workspace:createWorkspace', async (_event, name: string) => {
    try {
      const docsDir = join(app.getPath('documents'), 'VisionAgent')
      if (!existsSync(docsDir)) {
        await mkdir(docsDir, { recursive: true })
      }
      const dirPath = join(docsDir, name)
      if (existsSync(dirPath)) return null
      await mkdir(dirPath, { recursive: true })
      return dirPath
    } catch (err) {
      console.error('Failed to create workspace:', err)
      return null
    }
  })

  ipcMain.handle('workspace:deleteWorkspace', async (_event, dirPath: string) => {
    if (!isPathAuthorized(dirPath)) return { success: false, error: 'Path not authorized' }
    try {
      await rm(dirPath, { recursive: true, force: true })
      removeAuthorizedDirectory(dirPath)
      const dirs = getAuthorizedDirectories()
      if (dirs.length > 0) {
        await fileIndexService.init(dirs[0])
      } else {
        fileIndexService.destroy()
      }
      pushSettingsToRenderer()
      return { success: true }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
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
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
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
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
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
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('workspace:deleteDir', async (_event, dirPath: string) => {
    if (!isPathAuthorized(dirPath)) return { success: false, error: 'Path not authorized' }
    try {
      await rm(dirPath, { recursive: true, force: true })
      return { success: true }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('workspace:listMarkdownFiles', async (_event, dirPath: string) => {
    if (!isPathAuthorized(dirPath)) return []
    try {
      return await listMarkdownFiles(dirPath)
    } catch {
      return []
    }
  })

  ipcMain.handle('workspace:openInBrowser', async (_event, filePath: string) => {
    if (!isPathAuthorized(filePath)) return
    await shell.openPath(filePath)
  })

  ipcMain.handle('workspace:previewArtifact', async (_event, options: { fileName: string; content: string }) => {
    const tmpDir = join(app.getPath('temp'), 'vision-agent-preview')
    await mkdir(tmpDir, { recursive: true })
    const filePath = join(tmpDir, options.fileName)
    await writeFile(filePath, options.content, 'utf-8')
    await shell.openPath(filePath)
    return { success: true, filePath }
  })

  ipcMain.handle('workspace:saveArtifact', async (_event, options: { fileName: string; content: string; defaultPath?: string }) => {
    const window = getMainWindow()
    if (!window) return { success: false }
    const { canceled, filePath } = await dialog.showSaveDialog(window, {
      defaultPath: options.defaultPath ? join(options.defaultPath, options.fileName) : options.fileName,
      filters: [{ name: 'HTML', extensions: ['html'] }]
    })
    if (canceled || !filePath) return { success: false }
    await writeFile(filePath, options.content, 'utf-8')
    return { success: true, filePath }
  })

  ipcMain.handle('workspace:knowledgeDir', () => getKnowledgeBaseDir())

  // --- Settings ---
  ipcMain.handle('settings:get', () => getSettings())

  ipcMain.handle('settings:addProfile', (_event, profile: Record<string, unknown>) => {
    addProfile(profile as { id: string; name: string; apiKey: string; apiProvider: string; baseUrl: string; model: string })
    pushSettingsToRenderer()
    return { success: true }
  })

  ipcMain.handle('settings:updateProfile', (_event, id: string, updates: Record<string, unknown>) => {
    // If apiKey is masked (contains ***), skip updating it — renderer received a masked key
    const safeUpdates = { ...updates }
    if (typeof safeUpdates.apiKey === 'string' && safeUpdates.apiKey.includes('***')) {
      delete safeUpdates.apiKey
    }
    updateProfile(id, safeUpdates)
    pushSettingsToRenderer()
    return { success: true }
  })

  ipcMain.handle('settings:removeProfile', (_event, id: string) => {
    removeProfile(id)
    pushSettingsToRenderer()
    return { success: true }
  })

  ipcMain.handle('settings:setActiveProfile', (_event, id: string) => {
    setActiveProfile(id)
    pushSettingsToRenderer()
    return { success: true }
  })

  ipcMain.handle('settings:addDirectory', async (_event, dir: string) => {
    addAuthorizedDirectory(dir)
    await fileIndexService.init(dir)
    pushSettingsToRenderer()
    return { success: true }
  })

  ipcMain.handle('settings:removeDirectory', async (_event, dir: string) => {
    removeAuthorizedDirectory(dir)
    const dirs = getAuthorizedDirectories()
    if (dirs.length > 0) {
      await fileIndexService.init(dirs[0])
    } else {
      fileIndexService.destroy()
    }
    pushSettingsToRenderer()
    return { success: true }
  })

  ipcMain.handle('settings:reorderDirectories', (_event, paths: string[]) => {
    reorderAuthorizedDirectories(paths)
    pushSettingsToRenderer()
    return { success: true }
  })

  ipcMain.handle('settings:getTheme', () => getTheme())

  ipcMain.handle('settings:setTheme', (_event, theme: 'light' | 'dark' | 'system') => {
    setTheme(theme)
    if (theme === 'system') {
      nativeTheme.themeSource = 'system'
    } else {
      nativeTheme.themeSource = theme
    }
    pushSettingsToRenderer()
    return { success: true }
  })

  // --- Agent ---
  ipcMain.handle('agent:sendMessage', async (_event, prompt: string, sessionId?: string, activeFilePath?: string, skillId?: string, context?: AgentContext) => {
    const window = getMainWindow()
    if (!window) throw new Error('No main window')
    setActiveSkillId(skillId || null, context || 'editor')
    sendMessage(window, prompt, sessionId, activeFilePath, context || 'editor')
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

  ipcMain.handle('agent:listSdkSessions', async () => {
    return await listSdkSessions()
  })

  ipcMain.handle('agent:loadSessionMessages', async (_event, sessionId: string) => {
    return await loadSdkSessionMessages(sessionId)
  })

  ipcMain.handle('agent:abort', (_event, context?: AgentContext) => {
    abortActiveQuery(context)
    return { success: true }
  })

  ipcMain.handle('agent:selectFolder', async () => {
    const window = getMainWindow()
    if (!window) return { canceled: true, filePaths: [] }
    return await dialog.showOpenDialog(window, {
      properties: ['openDirectory'],
    })
  })

  // --- Memory ---
  ipcMain.handle('memory:list', async () => {
    const dirs = getAuthorizedDirectories()
    const cwd = dirs.length > 0 ? dirs[0] : process.cwd()
    const memoryDir = join(cwd, '.vision', 'memory')
    if (!existsSync(memoryDir)) return []
    try {
      const entries = await readdir(memoryDir, { withFileTypes: true })
      return entries
        .filter((e) => e.isFile() && extname(e.name) === '.md' && e.name !== 'MEMORY.md')
        .map((e) => ({
          name: e.name.replace(/\.md$/, ''),
          path: join(memoryDir, e.name)
        }))
    } catch {
      return []
    }
  })

  ipcMain.handle('memory:read', async (_event, filePath: string) => {
    if (!isPathAuthorized(filePath)) return { success: false, error: 'Path not authorized' }
    try {
      const content = await readFile(filePath, 'utf-8')
      return { success: true, content }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('memory:write', async (_event, filePath: string, content: string) => {
    if (!isPathAuthorized(filePath)) return { success: false, error: 'Path not authorized' }
    try {
      const dir = join(filePath, '..')
      if (!existsSync(dir)) {
        await mkdir(dir, { recursive: true })
      }
      await writeFile(filePath, content, 'utf-8')
      return { success: true }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('memory:delete', async (_event, filePath: string) => {
    if (!isPathAuthorized(filePath)) return { success: false, error: 'Path not authorized' }
    try {
      await unlink(filePath)
      return { success: true }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  // --- Cron ---
  ipcMain.handle('cron:register', async (_event, cronExpression: string, prompt: string, name?: string) => {
    try {
      const task = registerTask(cronExpression, prompt, name)
      return { success: true, task }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('cron:list', () => {
    return listTasks()
  })

  ipcMain.handle('cron:remove', (_event, taskId: string) => {
    return removeTask(taskId)
  })

  ipcMain.handle('cron:execute', async (_event, taskId: string) => {
    try {
      const result = await executeTaskById(taskId)
      return { success: true, result }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  // --- Graph ---
  ipcMain.handle('graph:getData', async () => {
    await fileIndexService.onReady()
    const rawWikilinkData = fileIndexService.getGraphData()
    const wikilinkData: { nodes: GraphNode[]; edges: GraphEdge[] } = {
      nodes: rawWikilinkData.nodes as GraphNode[],
      edges: rawWikilinkData.edges.map(e => ({ ...e, type: 'reference' as const }))
    }
    const knowledgeDir = getKnowledgeBaseDir()
    const semanticRaw = await loadSemanticGraph(knowledgeDir)
    const semanticData = semanticDataToGraph(semanticRaw)
    return mergeGraphData(wikilinkData, semanticData)
  })

  ipcMain.handle('graph:extractSemantic', async () => {
    const knowledgeDir = getKnowledgeBaseDir()
    const changedFiles = fileIndexService.getAndClearKnowledgeChangedFiles()
    const window = getMainWindow()
    try {
      const result = await extractSemanticGraph(knowledgeDir, changedFiles, (phase, progress) => {
        if (window) {
          window.webContents.send('graph:semanticProgress', { phase, progress })
        }
      })
      if (result.skipped) {
        return { success: true, skipped: true, message: 'No new or changed files to extract', nodes: result.nodes.length, edges: result.edges.length }
      }
      return { success: true, nodes: result.nodes.length, edges: result.edges.length }
    } catch (err) {
      console.error('[GraphExtractor] extractSemantic failed:', err)
      return { success: false, error: (err as Error).message }
    }
  })

  // --- Skills ---
  ipcMain.handle('skills:list', async () => {
    return getBuiltinSkills()
  })

  // --- Search ---
  ipcMain.handle('search:query', async (_event, keyword: string) => {
    if (!keyword.trim()) return []
    await fileIndexService.onReady()
    const results = fileIndexService.search(keyword)
    return results.map((r) => ({
      filePath: r.filePath,
      fileName: basename(r.filePath),
      line: r.line,
      content: r.snippet
    }))
  })

  // --- Notification ---
  ipcMain.handle('notification:getHistory', async () => {
    return getNotificationHistory()
  })

  // --- Connection Test ---
  ipcMain.handle('settings:testConnection', async (_event, options: { baseUrl: string; apiKey: string; model: string }) => {
    try {
      // Use the real API key from the store, not the masked key from the renderer
      const apiKey = getApiKey()
      if (!apiKey) return { success: false, message: '未找到有效的 API Key，请先在设置中配置' }
      const baseUrl = (options.baseUrl || getBaseUrl()).replace(/\/+$/, '')
      const url = `${baseUrl}/v1/messages`
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: options.model,
          max_tokens: 16,
          messages: [{ role: 'user', content: 'Hi' }]
        }),
        signal: AbortSignal.timeout(15000)
      })
      if (response.ok) {
        return { success: true, message: '连接成功' }
      }
      const body = await response.text().catch(() => '')
      let errorMsg = `HTTP ${response.status}`
      try {
        const json = JSON.parse(body)
        errorMsg = json.error?.message || json.message || errorMsg
      } catch {}
      return { success: false, message: errorMsg }
    } catch (err) {
      return { success: false, message: (err as Error).message }
    }
  })
}