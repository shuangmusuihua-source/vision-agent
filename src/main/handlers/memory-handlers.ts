import { ipcMain } from 'electron'
import { join, extname, dirname } from 'path'
import { readFile, writeFile, mkdir, unlink, readdir } from 'fs/promises'
import { existsSync } from 'fs'
import { getAuthorizedDirectories } from '../store'
import { isPathAuthorized } from '../path-validator'

export function registerMemoryHandlers(): void {
  ipcMain.handle('memory:list', async () => {
    const dirs = getAuthorizedDirectories()
    const cwd = dirs.length > 0 ? dirs[0] : process.cwd()
    const memoryDir = join(cwd, '.vision', 'memory')
    if (!existsSync(memoryDir)) return []
    try {
      const entries = await readdir(memoryDir, { withFileTypes: true })
      return entries
        .filter((e) => e.isFile() && extname(e.name) === '.md' && e.name !== 'MEMORY.md')
        .map((e) => ({ name: e.name.replace(/\.md$/, ''), path: join(memoryDir, e.name) }))
    } catch (e) { console.error('[memory:list] failed:', memoryDir, e); return [] }
  })

  ipcMain.handle('memory:read', async (_event, filePath: string) => {
    if (!isPathAuthorized(filePath)) return { success: false, error: 'Path not authorized' }
    try { const content = await readFile(filePath, 'utf-8'); return { success: true, content } }
    catch (err) { return { success: false, error: (err as Error).message } }
  })

  ipcMain.handle('memory:write', async (_event, filePath: string, content: string) => {
    if (!isPathAuthorized(filePath)) return { success: false, error: 'Path not authorized' }
    try {
      const dir = dirname(filePath)
      if (!existsSync(dir)) await mkdir(dir, { recursive: true })
      await writeFile(filePath, content, 'utf-8')
      return { success: true }
    } catch (err) { return { success: false, error: (err as Error).message } }
  })

  ipcMain.handle('memory:delete', async (_event, filePath: string) => {
    if (!isPathAuthorized(filePath)) return { success: false, error: 'Path not authorized' }
    try { await unlink(filePath); return { success: true } }
    catch (err) { return { success: false, error: (err as Error).message } }
  })
}
