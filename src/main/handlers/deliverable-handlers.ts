import { ipcMain } from 'electron'
import { listDeliverables, getDeliverable, deleteDeliverable } from '../deliverable-service'
import { isPathAuthorized } from '../path-validator'

function isAuthorizedWorkspacePath(workspacePath: unknown): workspacePath is string {
  return typeof workspacePath === 'string' && isPathAuthorized(workspacePath)
}

export function registerDeliverableHandlers(): void {
  ipcMain.handle('deliverable:list', async (_event, workspacePath: unknown) => {
    if (!isAuthorizedWorkspacePath(workspacePath)) return []
    try { return await listDeliverables(workspacePath) }
    catch (e) { console.error('[deliverable:list] failed:', e); return [] }
  })

  ipcMain.handle('deliverable:get', async (_event, workspacePath: unknown, id: string) => {
    if (!isAuthorizedWorkspacePath(workspacePath)) return null
    try { return await getDeliverable(workspacePath, id) }
    catch (e) { console.error('[deliverable:get] failed:', e); return null }
  })

  ipcMain.handle('deliverable:delete', async (_event, workspacePath: unknown, id: string) => {
    if (!isAuthorizedWorkspacePath(workspacePath)) {
      return { success: false, error: 'Path not authorized' }
    }
    try { await deleteDeliverable(workspacePath, id); return { success: true } }
    catch (e) { return { success: false, error: (e as Error).message } }
  })
}
