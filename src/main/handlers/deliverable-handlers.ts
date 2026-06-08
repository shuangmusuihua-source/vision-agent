import { ipcMain } from 'electron'
import {
  listDeliverables,
  getDeliverable,
  deleteDeliverable,
} from '../deliverable-service'
import { getMainWindow } from '../ipc-sender'

export function registerDeliverableHandlers(): void {
  ipcMain.handle('deliverable:list', async (_event, workspacePath: string) => {
    try { return await listDeliverables(workspacePath) }
    catch (e) { console.error('[deliverable:list] failed:', e); return [] }
  })

  ipcMain.handle('deliverable:get', async (_event, workspacePath: string, id: string) => {
    try { return await getDeliverable(workspacePath, id) }
    catch (e) { console.error('[deliverable:get] failed:', e); return null }
  })

  ipcMain.handle('deliverable:delete', async (_event, workspacePath: string, id: string) => {
    try {
      await deleteDeliverable(workspacePath, id)
      return { success: true }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })
}
