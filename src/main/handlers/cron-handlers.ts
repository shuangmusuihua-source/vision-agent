import { ipcMain } from 'electron'
import { registerTask, removeTask, listTasks, executeTaskById } from '../cron-manager'

export function registerCronHandlers(): void {
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
}
