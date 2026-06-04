import { ipcMain } from 'electron'
import { basename, join, extname } from 'path'
import { readFile, writeFile, mkdir, unlink, readdir } from 'fs/promises'
import { existsSync } from 'fs'
import { getAuthorizedDirectories, getApiKey, getBaseUrl, getEnabledSkills, toggleSkill } from '../store'
import { fileIndexService } from '../file-index-service'
import { isPathAuthorized } from '../path-validator'
import { getBuiltinSkills } from '../skills/builtin'
import { registerTask, removeTask, listTasks, executeTaskById } from '../cron-manager'
import { getNotificationHistory } from '../notification-manager'
import type { GraphNode } from '../../shared/types'

export function registerSystemHandlers(): void {
  // --- Memory ---
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
      const dir = join(filePath, '..')
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

  // --- Cron ---
  ipcMain.handle('cron:register', async (_event, cronExpression: string, prompt: string, name?: string) => {
    try { const task = registerTask(cronExpression, prompt, name); return { success: true, task } }
    catch (err) { return { success: false, error: (err as Error).message } }
  })
  ipcMain.handle('cron:list', () => listTasks())
  ipcMain.handle('cron:remove', (_event, taskId: string) => removeTask(taskId))
  ipcMain.handle('cron:execute', async (_event, taskId: string) => {
    try { const result = await executeTaskById(taskId); return { success: true, result } }
    catch (err) { return { success: false, error: (err as Error).message } }
  })

  // --- Graph ---
  ipcMain.handle('graph:getData', async () => {
    await Promise.all([fileIndexService.onReady(), fileIndexService.onKnowledgeReady()])
    const rawData = fileIndexService.getKnowledgeGraphData()
    return {
      nodes: rawData.nodes as GraphNode[],
      edges: rawData.edges.map(e => ({ ...e, type: 'reference' as const })),
    }
  })

  // --- Skills ---
  ipcMain.handle('skills:list', async () => {
    const skills = getBuiltinSkills()
    const enabled = getEnabledSkills()
    return skills.map((s) => ({ ...s, enabled: enabled.includes(s.id) }))
  })

  ipcMain.handle('skills:toggle', async (_event, skillId: string, enabled: boolean) => {
    return toggleSkill(skillId, enabled)
  })

  ipcMain.handle('skills:getEnabled', async () => {
    return getEnabledSkills()
  })

  // --- Search ---
  ipcMain.handle('search:query', async (_event, keyword: string) => {
    if (!keyword.trim()) return []
    await fileIndexService.onReady()
    const results = fileIndexService.search(keyword)
    return results.map((r) => ({ filePath: r.filePath, fileName: basename(r.filePath), line: r.line, content: r.snippet }))
  })

  // --- Notification ---
  ipcMain.handle('notification:getHistory', async () => getNotificationHistory())

  // --- Connection Test ---
  ipcMain.handle('settings:testConnection', async (_event, options: { baseUrl: string; apiKey: string; model: string }) => {
    try {
      const apiKey = getApiKey()
      if (!apiKey) return { success: false, message: '未找到有效的 API Key，请先在设置中配置' }
      const baseUrl = (options.baseUrl || getBaseUrl()).replace(/\/+$/, '')
      const response = await fetch(`${baseUrl}/v1/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: options.model, max_tokens: 16, messages: [{ role: 'user', content: 'Hi' }] }),
        signal: AbortSignal.timeout(15000),
      })
      if (response.ok) return { success: true, message: '连接成功' }
      const body = await response.text().catch(() => '')
      let errorMsg = `HTTP ${response.status}`
      try { errorMsg = JSON.parse(body).error?.message || JSON.parse(body).message || errorMsg } catch {}
      return { success: false, message: errorMsg }
    } catch (err) { return { success: false, message: (err as Error).message } }
  })
}
