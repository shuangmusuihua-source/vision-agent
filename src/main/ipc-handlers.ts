import { ipcMain, dialog, shell, nativeTheme, app } from 'electron'
import { readFile, writeFile, readdir, mkdir, unlink } from 'fs/promises'
import { join, extname, relative, basename } from 'path'
import { existsSync } from 'fs'
import { getMainWindow } from './index'
import { sendMessage, getSessionList, resolvePermission, resolveAskUser, listSdkSessions, loadSdkSessionMessages } from './agent-manager'
import { registerTask, removeTask, listTasks, executeTaskById } from './cron-manager'
import { getBuiltinSkills } from './skills/builtin'
import { extractSemanticGraph, loadSemanticGraph, mergeGraphData, semanticDataToGraph } from './semantic-extractor'
import type { GraphNode, GraphEdge, GraphData, FileEntry } from '../shared/types'
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
  getTheme,
  setTheme
} from './store'
import { getNotificationHistory } from './notification-manager'
import { fileIndexService } from './file-index-service'

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
    try {
      return await scanDirectory(dirPath)
    } catch {
      return []
    }
  })

  ipcMain.handle('workspace:readFile', async (_event, filePath: string) => {
    try {
      const content = await readFile(filePath, 'utf-8')
      return { success: true, content }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('workspace:writeFile', async (_event, filePath: string, content: string) => {
    try {
      await writeFile(filePath, content, 'utf-8')
      return { success: true }
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

  ipcMain.handle('workspace:createFile', async (_event, dirPath: string, fileName: string) => {
    try {
      let name = fileName.trim()
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

  ipcMain.handle('workspace:listMarkdownFiles', async (_event, dirPath: string) => {
    try {
      return await listMarkdownFiles(dirPath)
    } catch {
      return []
    }
  })

  ipcMain.handle('workspace:openInBrowser', async (_event, filePath: string) => {
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

  // --- Settings ---
  ipcMain.handle('settings:get', () => getSettings())

  ipcMain.handle('settings:addProfile', (_event, profile: Record<string, unknown>) => {
    addProfile(profile as { id: string; name: string; apiKey: string; apiProvider: string; model: string })
    pushSettingsToRenderer()
    return { success: true }
  })

  ipcMain.handle('settings:updateProfile', (_event, id: string, updates: Record<string, unknown>) => {
    updateProfile(id, updates)
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
  ipcMain.handle('agent:sendMessage', async (_event, prompt: string, sessionId?: string, activeFilePath?: string) => {
    console.log('[IPC] agent:sendMessage called, prompt length:', prompt?.length, 'sessionId:', sessionId)
    const window = getMainWindow()
    if (!window) throw new Error('No main window')
    sendMessage(window, prompt, sessionId, activeFilePath)
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
    try {
      const content = await readFile(filePath, 'utf-8')
      return { success: true, content }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('memory:write', async (_event, filePath: string, content: string) => {
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
    const dirs = getAuthorizedDirectories()
    const cwd = dirs.length > 0 ? dirs[0] : process.cwd()
    const semanticRaw = await loadSemanticGraph(cwd)
    const semanticData = semanticDataToGraph(semanticRaw)
    return mergeGraphData(wikilinkData, semanticData)
  })

  ipcMain.handle('graph:extractSemantic', async () => {
    const dirs = getAuthorizedDirectories()
    const cwd = dirs.length > 0 ? dirs[0] : process.cwd()
    const window = getMainWindow()
    const changedFiles = fileIndexService.getAndClearChangedFiles()
    try {
      const result = await extractSemanticGraph(cwd, changedFiles, (phase, progress) => {
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
      const baseUrl = options.baseUrl.replace(/\/+$/, '')
      const url = `${baseUrl}/v1/messages`
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': options.apiKey,
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