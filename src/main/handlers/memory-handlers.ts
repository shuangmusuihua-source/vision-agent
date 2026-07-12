import { ipcMain } from 'electron'
import {
  deleteMemoryDocument,
  listMemoryEntries,
  readMemoryDocument,
  updateMemoryDocument,
} from '../memory-files'
import { getGlobalMemoryDirectory } from '../memory-policy'

export function registerMemoryHandlers(): void {
  ipcMain.handle('memory:list', async () => {
    try { return await listMemoryEntries(getGlobalMemoryDirectory()) }
    catch (error) {
      console.error('[memory:list] failed:', error)
      throw error
    }
  })

  ipcMain.handle('memory:read', async (_event, filePath: string) => {
    try { return { success: true, document: await readMemoryDocument(filePath, getGlobalMemoryDirectory()) } }
    catch (error) { return { success: false, error: (error as Error).message } }
  })

  ipcMain.handle('memory:update', async (_event, request: { filePath: string; content: string }) => {
    try {
      const document = await updateMemoryDocument(request.filePath, request.content, getGlobalMemoryDirectory())
      return { success: true, document }
    } catch (error) { return { success: false, error: (error as Error).message } }
  })

  ipcMain.handle('memory:delete', async (_event, filePath: string) => {
    try {
      await deleteMemoryDocument(filePath, getGlobalMemoryDirectory())
      return { success: true }
    } catch (error) { return { success: false, error: (error as Error).message } }
  })
}
