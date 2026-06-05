import { ipcMain } from 'electron'
import { readdir } from 'fs/promises'
import { join, extname } from 'path'
import { getMainWindow } from './ipc-sender'
import { getSettings } from './store'
import type { FileEntry } from '../shared/types'
import { registerWorkspaceHandlers } from './handlers/workspace-handlers'
import { registerSettingsHandlers } from './handlers/settings-handlers'
import { registerAgentHandlers } from './handlers/agent-handlers'
import { registerSystemHandlers } from './handlers/system-handlers'

// ─── Shared helpers ──────────────────────────────────────────────

function pushSettingsToRenderer(): void {
  const window = getMainWindow()
  if (window && !window.isDestroyed()) {
    window.webContents.send('settings:changed', getSettings())
  }
}

async function scanDirectory(dirPath: string, maxDepth = 1, depth = 0): Promise<FileEntry[]> {
  if (depth >= maxDepth) return []
  const entries = await readdir(dirPath, { withFileTypes: true })
  const result: FileEntry[] = []
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const fullPath = join(dirPath, entry.name)
    if (entry.isDirectory()) {
      const children = await scanDirectory(fullPath, maxDepth, depth + 1)
      if (children.length > 0) {
        result.push({ name: entry.name, path: fullPath, isDirectory: true, children })
      }
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
      if (entry.isDirectory()) { await walk(fullPath) }
      else if (extname(entry.name) === '.md') {
        results.push({ label: entry.name.replace(/\.md$/, ''), path: fullPath })
      }
    }
  }
  await walk(dirPath)
  return results
}

// ─── Registration ────────────────────────────────────────────────

export { scanDirectory }
export { pushSettingsToRenderer }

export function registerIpcHandlers(): void {
  ipcMain.handle('ping', () => 'pong')

  registerWorkspaceHandlers(scanDirectory, listMarkdownFiles, pushSettingsToRenderer)
  registerSettingsHandlers(pushSettingsToRenderer)
  registerAgentHandlers()
  registerSystemHandlers()
}
