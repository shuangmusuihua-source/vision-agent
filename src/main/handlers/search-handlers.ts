import { ipcMain } from 'electron'
import { basename } from 'path'
import { fileIndexService } from '../file-index-service'

export function registerSearchHandlers(): void {
  ipcMain.handle('search:query', async (_event, keyword: string) => {
    if (!keyword.trim()) return []
    await fileIndexService.onReady()
    const results = fileIndexService.search(keyword)
    return results.map((r) => ({ filePath: r.filePath, fileName: basename(r.filePath), line: r.line, content: r.snippet }))
  })
}
