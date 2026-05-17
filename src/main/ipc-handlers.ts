import { ipcMain, dialog } from 'electron'
import { readFile, writeFile, readdir, mkdir, unlink } from 'fs/promises'
import { join, extname, relative } from 'path'
import { existsSync } from 'fs'
import { getMainWindow } from './index'
import { sendMessage, getSessionList, resolvePermission, listSdkSessions, loadSdkSessionMessages } from './agent-manager'
import { registerTask, removeTask, listTasks, executeTaskById } from './cron-manager'
import { listSkills } from './agent-manager'
import {
  getSettings,
  addProfile,
  updateProfile,
  removeProfile,
  setActiveProfile,
  addAuthorizedDirectory,
  removeAuthorizedDirectory,
  getAuthorizedDirectories,
  getTheme,
  setTheme
} from './store'

// --- Workspace ---

interface FileEntry {
  name: string
  path: string
  isDirectory: boolean
  children?: FileEntry[]
}

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

// --- Graph data builder ---

interface GraphNode {
  id: string
  label: string
  type: 'file' | 'memory'
}

interface GraphEdge {
  source: string
  target: string
}

async function buildGraphData(cwd: string): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []
  const fileMap = new Map<string, string>() // label without .md → absolute path

  // Collect workspace .md files
  async function walkMdFiles(dir: string): Promise<void> {
    if (!existsSync(dir)) return
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.vision') continue
      const fullPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walkMdFiles(fullPath)
      } else if (extname(entry.name) === '.md') {
        const label = entry.name.replace(/\.md$/, '')
        const relPath = relative(cwd, fullPath)
        const isMemory = fullPath.includes('.vision/memory')
        nodes.push({ id: fullPath, label, type: isMemory ? 'memory' : 'file' })
        fileMap.set(label, fullPath)
        fileMap.set(relPath, fullPath)
      }
    }
  }

  await walkMdFiles(cwd)

  // Parse [[wikilinks]] from each file
  const wikilinkPattern = /\[\[([^\]]+)\]\]/g
  for (const node of nodes) {
    try {
      const content = await readFile(node.id, 'utf-8')
      let match: RegExpExecArray | null
      while ((match = wikilinkPattern.exec(content)) !== null) {
        const target = match[1]
        const targetPath = fileMap.get(target) || fileMap.get(target.replace(/\.md$/, ''))
        if (targetPath && targetPath !== node.id) {
          edges.push({ source: node.id, target: targetPath })
        }
      }
    } catch {
      // Skip unreadable files
    }
  }

  return { nodes, edges }
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

  ipcMain.handle('workspace:listMarkdownFiles', async (_event, dirPath: string) => {
    try {
      return await listMarkdownFiles(dirPath)
    } catch {
      return []
    }
  })

  // --- Settings ---
  ipcMain.handle('settings:get', () => getSettings())

  ipcMain.handle('settings:addProfile', (_event, profile: Record<string, unknown>) => {
    addProfile(profile as { id: string; name: string; apiKey: string; apiProvider: 'anthropic' | 'bedrock' | 'vertex' | 'azure'; model: string })
    return { success: true }
  })

  ipcMain.handle('settings:updateProfile', (_event, id: string, updates: Record<string, unknown>) => {
    updateProfile(id, updates)
    return { success: true }
  })

  ipcMain.handle('settings:removeProfile', (_event, id: string) => {
    removeProfile(id)
    return { success: true }
  })

  ipcMain.handle('settings:setActiveProfile', (_event, id: string) => {
    setActiveProfile(id)
    return { success: true }
  })

  ipcMain.handle('settings:addDirectory', (_event, dir: string) => {
    addAuthorizedDirectory(dir)
    return { success: true }
  })

  ipcMain.handle('settings:removeDirectory', (_event, dir: string) => {
    removeAuthorizedDirectory(dir)
    return { success: true }
  })

  ipcMain.handle('settings:getTheme', () => getTheme())

  ipcMain.handle('settings:setTheme', (_event, theme: 'light' | 'dark' | 'system') => {
    setTheme(theme)
    return { success: true }
  })

  // --- Agent ---
  ipcMain.handle('agent:sendMessage', async (_event, prompt: string, sessionId?: string, activeFilePath?: string) => {
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
    const dirs = getAuthorizedDirectories()
    const allNodes: GraphNode[] = []
    const allEdges: GraphEdge[] = []
    for (const dir of dirs) {
      const data = await buildGraphData(dir)
      allNodes.push(...data.nodes)
      allEdges.push(...data.edges)
    }
    // Deduplicate nodes by id
    const nodeMap = new Map<string, GraphNode>()
    for (const n of allNodes) nodeMap.set(n.id, n)
    const edgeSet = new Set<string>()
    const dedupedEdges: GraphEdge[] = []
    for (const e of allEdges) {
      const key = `${e.source}->${e.target}`
      if (!edgeSet.has(key)) {
        edgeSet.add(key)
        dedupedEdges.push(e)
      }
    }
    return { nodes: Array.from(nodeMap.values()), edges: dedupedEdges }
  })

  // --- Skills ---
  ipcMain.handle('skills:list', async () => {
    return await listSkills()
  })

  // --- Search ---
  ipcMain.handle('search:query', async (_event, keyword: string) => {
    if (!keyword.trim()) return []
    const dirs = getAuthorizedDirectories()
    const results: Array<{ filePath: string; fileName: string; line: number; content: string }> = []
    const lowerKeyword = keyword.toLowerCase()

    for (const dir of dirs) {
      async function walkSearch(d: string): Promise<void> {
        if (!existsSync(d)) return
        const entries = await readdir(d, { withFileTypes: true })
        for (const entry of entries) {
          if (entry.name.startsWith('.') && entry.name !== '.vision') continue
          const fullPath = join(d, entry.name)
          if (entry.isDirectory()) {
            await walkSearch(fullPath)
          } else if (extname(entry.name) === '.md') {
            try {
              const content = await readFile(fullPath, 'utf-8')
              const lines = content.split('\n')
              for (let i = 0; i < lines.length; i++) {
                if (lines[i].toLowerCase().includes(lowerKeyword)) {
                  results.push({
                    filePath: fullPath,
                    fileName: entry.name,
                    line: i + 1,
                    content: lines[i].trim()
                  })
                }
              }
            } catch {
              // Skip unreadable files
            }
          }
        }
      }
      await walkSearch(dir)
    }

    // Limit to 100 results
    return results.slice(0, 100)
  })
}