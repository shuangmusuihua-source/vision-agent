import { ipcMain } from 'electron'
import { registerTask, removeTask, listTasks, executeTaskById, stopTaskById, setTaskStatus } from '../cron-manager'
import { resolveCronSchedule } from '../cron-schedule-parser'
import type { CronScheduleParseRequest, CronTaskRegistration } from '../../shared/cron-types'

export function registerCronHandlers(): void {
  ipcMain.handle('cron:register', async (_event, requestOrCron: CronTaskRegistration | string, prompt?: string, name?: string) => {
    try {
      const registration: CronTaskRegistration = typeof requestOrCron === 'string'
        ? { cronExpression: requestOrCron, prompt: prompt || '', name }
        : requestOrCron
      const task = registerTask(registration)
      return { success: true, task }
    }
    catch (err) { return { success: false, error: (err as Error).message } }
  })
  ipcMain.handle('cron:list', () => listTasks())
  ipcMain.handle('cron:resolveSchedule', async (_event, request: CronScheduleParseRequest) => resolveCronSchedule(request))
  ipcMain.handle('cron:remove', (_event, taskId: string) => removeTask(taskId))
  ipcMain.handle('cron:execute', async (_event, taskId: string) => {
    try { const result = await executeTaskById(taskId); return { success: true, result } }
    catch (err) { return { success: false, error: (err as Error).message } }
  })
  ipcMain.handle('cron:stop', (_event, taskId: string) => {
    try {
      const stopped = stopTaskById(taskId)
      return stopped ? { success: true } : { success: false, error: '任务当前没有运行' }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })
  ipcMain.handle('cron:setStatus', (_event, request: { taskId: string; status: 'active' | 'paused' }) => {
    try {
      const task = setTaskStatus(request.taskId, request.status)
      return { success: true, task }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })
}
