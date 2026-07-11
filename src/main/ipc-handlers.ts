import { app, ipcMain } from 'electron'
import { readdir } from 'fs/promises'
import { join, extname } from 'path'
import { getMainWindow } from './ipc-sender'
import { getSettings } from './persistence/profile-store'
import { registerWorkspaceHandlers } from './handlers/workspace-handlers'
import { registerSettingsHandlers } from './handlers/settings-handlers'
import { registerAgentHandlers } from './handlers/agent-handlers'
import { registerSystemHandlers } from './handlers/system-handlers'
import { registerEditorHandlers } from './handlers/editor-handlers'

// ─── Shared helpers ──────────────────────────────────────────────

function pushSettingsToRenderer(): void {
  const window = getMainWindow()
  if (window && !window.isDestroyed()) {
    window.webContents.send('settings:changed', getSettings())
  }
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

export { pushSettingsToRenderer }

export function registerIpcHandlers(): void {
  ipcMain.handle('app:getVersion', () => app.getVersion())

  registerWorkspaceHandlers(listMarkdownFiles, pushSettingsToRenderer)
  registerSettingsHandlers(pushSettingsToRenderer)
  registerAgentHandlers()
  registerEditorHandlers()
  registerSystemHandlers()
}
