import { ipcMain } from 'electron'
import { getSessionRecords, getSessionsByWorkspace } from '../store'

export function registerSessionHandlers(): void {
  ipcMain.handle('session:listByWorkspace', async (_event, workspacePath: string) => {
    return getSessionsByWorkspace(workspacePath)
  })

  ipcMain.handle('session:list', async () => getSessionRecords())
}
