import { ipcMain, dialog } from 'electron'
import { readFile, writeFile, readdir } from 'fs/promises'
import { join, extname, relative } from 'path'
import { getMainWindow } from './index'
import { sendMessage, getSessionList, resolvePermission, listSdkSessions, loadSdkSessionMessages } from './agent-manager'
import {
  getSettings,
  addProfile,
  updateProfile,
  removeProfile,
  setActiveProfile,
  addAuthorizedDirectory,
  removeAuthorizedDirectory
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

  // --- Agent ---
  ipcMain.handle('agent:sendMessage', async (_event, prompt: string, sessionId?: string) => {
    const window = getMainWindow()
    if (!window) throw new Error('No main window')
    sendMessage(window, prompt, sessionId)
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
}