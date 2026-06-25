import { ipcMain } from 'electron'
import { getSessionRecords, getSessionsByWorkspace } from '../store'
import { isPathAuthorized } from '../path-validator'

export function registerSessionHandlers(): void {
  ipcMain.handle('session:listByWorkspace', async (_event, workspacePath: unknown) => {
    if (typeof workspacePath !== 'string' || !isPathAuthorized(workspacePath)) {
      return []
    }
    return getSessionsByWorkspace(workspacePath)
  })

  ipcMain.handle('session:list', async () => getSessionRecords())
}
