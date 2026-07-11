import { ipcMain } from 'electron'
import { basename } from 'path'
import { fileIndexService } from '../file-index-service'
import { getAuthorizedDirectories } from '../persistence/workspace-store'
import { findContainingWorkspacePath } from '../../shared/workspace-paths'

export function registerSearchHandlers(): void {
  ipcMain.handle('search:query', async (_event, keyword: string) => {
    if (!keyword.trim()) return []
    await fileIndexService.onReady()
    const results = fileIndexService.search(keyword)
    const workspacePaths = getAuthorizedDirectories()
    return results.map((result) => {
      const workspacePath = findContainingWorkspacePath(result.filePath, workspacePaths)
      return {
        filePath: result.filePath,
        fileName: basename(result.filePath),
        workspaceName: workspacePath ? basename(workspacePath) : '',
        line: result.line,
        content: result.snippet,
      }
    })
  })
}
