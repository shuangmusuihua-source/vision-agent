import { ipcMain } from 'electron'
import { getSessionRecords, getSessionsByWorkspace } from '../store'

/**
 * Register session-related IPC handlers.
 * Phase 0: basic list/query stubs.
 * Phase 2: full CRUD + digest + merge with SDK sessions.
 */
export function registerSessionHandlers(): void {
  ipcMain.handle('session:listByWorkspace', async (_event, workspacePath: string) => {
    return getSessionsByWorkspace(workspacePath)
  })

  ipcMain.handle('session:list', async () => {
    return getSessionRecords()
  })
}
