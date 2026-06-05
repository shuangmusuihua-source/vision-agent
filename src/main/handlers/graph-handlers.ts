import { ipcMain } from 'electron'
import { fileIndexService } from '../file-index-service'
import type { GraphNode } from '../../shared/types'

export function registerGraphHandlers(): void {
  ipcMain.handle('graph:getData', async () => {
    await Promise.all([fileIndexService.onReady(), fileIndexService.onKnowledgeReady()])
    const rawData = fileIndexService.getKnowledgeGraphData()
    return {
      nodes: rawData.nodes as GraphNode[],
      edges: rawData.edges.map(e => ({ ...e, type: 'reference' as const })),
    }
  })
}
