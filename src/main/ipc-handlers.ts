import { app, ipcMain } from 'electron'
import { readdir } from 'fs/promises'
import { join, extname } from 'path'
import { getMainWindow } from './ipc-sender'
import { getSettings, getSessionsByWorkspace } from './store'
import type { WorkspaceDigest } from '../shared/types'
import { registerWorkspaceHandlers } from './handlers/workspace-handlers'
import { registerSettingsHandlers } from './handlers/settings-handlers'
import { registerAgentHandlers } from './handlers/agent-handlers'
import { registerSystemHandlers } from './handlers/system-handlers'
import { registerSessionHandlers } from './handlers/session-handlers'

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
  ipcMain.handle('ping', () => 'pong')
  ipcMain.handle('app:getVersion', () => app.getVersion())

  registerWorkspaceHandlers(listMarkdownFiles, pushSettingsToRenderer, getSessionOverview)
  registerSettingsHandlers(pushSettingsToRenderer)
  registerAgentHandlers()
  registerSystemHandlers()
  registerSessionHandlers()
}

// ─── Session Overview (Phase 0 stub, Phase 2 full implementation) ──

async function getSessionOverview(workspaceDir: string): Promise<WorkspaceDigest | null> {
  try {
    const records = getSessionsByWorkspace(workspaceDir)
    if (records.length === 0) return null

    const workspaceName = workspaceDir.split('/').pop() || workspaceDir

    return {
      workspacePath: workspaceDir,
      workspaceName,
      stats: {
        totalSessions: records.length,
        totalArtifacts: records.reduce((sum, r) => sum + r.artifactCount, 0),
        totalFiles: 0, // TODO: actual file count in Phase 2
        lastActiveAt: records.reduce((max, r) => Math.max(max, r.lastModified), 0) || null,
      },
      recentSessions: records.slice(0, 5).map(r => ({
        sessionId: r.id,
        title: r.title || r.firstPrompt || '未命名会话',
        firstPrompt: r.firstPrompt || '',
        assistantSummary: r.summary || '',
        createdAt: r.createdAt,
        lastModified: r.lastModified,
        messageCount: r.messageCount,
        artifactCount: r.artifactCount,
        status: r.status,
        artifactFiles: [],
      })),
      recentFiles: [],
    }
  } catch (err) {
    console.error('[getSessionOverview] failed:', err)
    return null
  }
}
