import { ipcMain } from 'electron'
import { join, extname } from 'path'
import { unlink, readdir } from 'fs/promises'
import { existsSync } from 'fs'
import { resolve, sep } from 'path'
import { getAuthorizedDirectories } from '../persistence/workspace-store'
import { isPathAuthorized } from '../path-validator'

function isMemoryPathAuthorized(filePath: string): boolean {
  const dirs = getAuthorizedDirectories()
  const resolved = resolve(filePath)
  return dirs.some((dir) => {
    const memoryRoot = resolve(dir, '.vision', 'memory') + sep
    return resolved.startsWith(memoryRoot) && !resolved.includes('..')
  })
}

export function registerMemoryHandlers(): void {
  ipcMain.handle('memory:list', async () => {
    const dirs = getAuthorizedDirectories()
    const results: Array<{ name: string; path: string }> = []
    const seen = new Set<string>()
    for (const cwd of dirs) {
      const memoryDir = join(cwd, '.vision', 'memory')
      if (!existsSync(memoryDir)) continue
      try {
        const entries = await readdir(memoryDir, { withFileTypes: true })
        for (const e of entries) {
          if (!e.isFile() || extname(e.name) !== '.md' || e.name === 'MEMORY.md') continue
          const name = e.name.replace(/\.md$/, '')
          if (seen.has(name)) continue
          seen.add(name)
          results.push({ name, path: join(memoryDir, e.name) })
        }
      } catch (e) { console.error('[memory:list] failed:', memoryDir, e) }
    }
    return results
  })

  ipcMain.handle('memory:delete', async (_event, filePath: string) => {
    if (!isPathAuthorized(filePath)) return { success: false, error: 'Path not authorized' }
    if (!isMemoryPathAuthorized(filePath)) return { success: false, error: 'Path must be within .vision/memory/' }
    try { await unlink(filePath); return { success: true } }
    catch (err) { return { success: false, error: (err as Error).message } }
  })
}
