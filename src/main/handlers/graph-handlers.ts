import { ipcMain } from 'electron'
import { fileIndexService } from '../file-index-service'

export function registerGraphHandlers(): void {
  ipcMain.handle('graph:getData', async () => {
    await Promise.all([fileIndexService.onReady(), fileIndexService.onKnowledgeReady()])
    return fileIndexService.getKnowledgeGraphData()
  })

  ipcMain.handle('graph:acknowledgeChanges', (_event, version: number) => {
    return fileIndexService.acknowledgeChanges(version)
  })
}
