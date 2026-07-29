import { app, ipcMain } from 'electron'
import { getMainWindow } from './ipc-sender'
import { getSettings } from './persistence/profile-store'
import { registerWorkspaceHandlers } from './handlers/workspace-handlers'
import { registerSettingsHandlers } from './handlers/settings-handlers'
import { registerAgentHandlers } from './handlers/agent-handlers'
import { registerEditorHandlers } from './handlers/editor-handlers'
import { registerMemoryHandlers } from './handlers/memory-handlers'
import { registerCronHandlers } from './handlers/cron-handlers'
import { registerGraphHandlers } from './handlers/graph-handlers'
import { registerSkillHandlers } from './handlers/skill-handlers'
import { registerSearchHandlers } from './handlers/search-handlers'
import { registerConnectionHandlers } from './handlers/connection-handlers'
import { registerAttachmentHandlers } from './handlers/attachment-handlers'
import { registerOfficeHandlers } from './handlers/office-handlers'
import { createWorkspaceLifecycle } from './workspace-lifecycle-adapter'

// ─── Shared helpers ──────────────────────────────────────────────

function pushSettingsToRenderer(): void {
  const window = getMainWindow()
  if (window && !window.isDestroyed()) {
    window.webContents.send('settings:changed', getSettings())
  }
}

// ─── Registration ────────────────────────────────────────────────

export function registerIpcHandlers(): void {
  ipcMain.handle('app:getVersion', () => app.getVersion())

  const workspaceLifecycle = createWorkspaceLifecycle()
  registerWorkspaceHandlers(workspaceLifecycle)
  registerSettingsHandlers(pushSettingsToRenderer, workspaceLifecycle)
  registerAgentHandlers()
  registerEditorHandlers()
  registerMemoryHandlers()
  registerCronHandlers()
  registerGraphHandlers()
  registerSkillHandlers()
  registerSearchHandlers()
  registerConnectionHandlers()
  registerAttachmentHandlers()
  registerOfficeHandlers()
}
