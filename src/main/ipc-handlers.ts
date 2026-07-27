import { app, ipcMain } from 'electron'
import { getMainWindow } from './ipc-sender'
import { getSettings } from './persistence/profile-store'
import { registerWorkspaceHandlers } from './handlers/workspace-handlers'
import { registerSettingsHandlers } from './handlers/settings-handlers'
import { registerAgentHandlers } from './handlers/agent-handlers'
import { registerSystemHandlers } from './handlers/system-handlers'
import { registerEditorHandlers } from './handlers/editor-handlers'
import { createWorkspaceLifecycle } from './workspace-lifecycle-adapter'

// ─── Shared helpers ──────────────────────────────────────────────

function pushSettingsToRenderer(): void {
  const window = getMainWindow()
  if (window && !window.isDestroyed()) {
    window.webContents.send('settings:changed', getSettings())
  }
}

// ─── Registration ────────────────────────────────────────────────

export { pushSettingsToRenderer }

export function registerIpcHandlers(): void {
  ipcMain.handle('app:getVersion', () => app.getVersion())

  const workspaceLifecycle = createWorkspaceLifecycle(pushSettingsToRenderer)
  registerWorkspaceHandlers(workspaceLifecycle)
  registerSettingsHandlers(pushSettingsToRenderer, workspaceLifecycle)
  registerAgentHandlers()
  registerEditorHandlers()
  registerSystemHandlers()
}
