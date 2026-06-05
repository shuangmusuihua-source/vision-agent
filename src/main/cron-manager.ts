import cron, { type ScheduledTask } from 'node-cron'
import { query } from '@anthropic-ai/claude-agent-sdk'
import * as Sentry from '@sentry/electron/main'
import { getMainWindow } from './ipc-sender'
import { getAuthorizedDirectories, getCronTasks, saveCronTasks, type CronTask } from './store'
import { buildAgentOptions, resolveClaudeCodeExecutable } from './agent-options'
import { notifyCronTaskComplete } from './notification-manager'

const tasks = new Map<string, { task: CronTask; job: ScheduledTask }>()
const runningTasks = new Set<string>()

function persistTasks(): void {
  saveCronTasks(Array.from(tasks.values()).map((e) => e.task))
}

export function restorePersistedTasks(): void {
  const persisted = getCronTasks()
  for (const task of persisted) {
    const job = cron.schedule(task.cronExpression, () => executeTask(task), {
      scheduled: true
    } as any)
    tasks.set(task.id, { task, job })
  }
}

export function registerTask(
  cronExpression: string,
  prompt: string,
  name?: string
): CronTask {
  const id = `cron-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  const task: CronTask = {
    id,
    name: name || prompt.substring(0, 30),
    cronExpression,
    prompt,
    createdAt: Date.now(),
    lastRunAt: null,
    lastResult: null,
    status: 'active'
  }

  const job = cron.schedule(cronExpression, () => executeTask(task), {
    scheduled: true
  } as any)

  tasks.set(id, { task, job })
  persistTasks()
  return task
}

export function removeTask(taskId: string): boolean {
  const entry = tasks.get(taskId)
  if (!entry) return false
  entry.job.stop()
  tasks.delete(taskId)
  persistTasks()
  return true
}

export function listTasks(): CronTask[] {
  return Array.from(tasks.values()).map((e) => e.task)
}

export function getTask(taskId: string): CronTask | undefined {
  return tasks.get(taskId)?.task
}

export async function executeTask(task: CronTask): Promise<void> {
  if (runningTasks.has(task.id)) return
  runningTasks.add(task.id)

  try {
  const authorizedRoots = getAuthorizedDirectories()
  const cwd = authorizedRoots.length > 0 ? authorizedRoots[0] : process.cwd()

  const options = buildAgentOptions({
    cwd,
    permissionMode: 'acceptEdits',
    allowedTools: ['Read', 'Glob', 'Grep', 'Write', 'Edit'],
    restrictiveBaseUrl: true,
    prependUserBinPaths: false,
    canUseTool: async (_toolName, input) => {
      const filePath = typeof input === 'object' && input !== null
        ? (input as Record<string, unknown>).file_path as string | undefined
        : undefined
      if (filePath) {
        const resolved = require('path').resolve(filePath)
        const isAuthorized = authorizedRoots.some((root: string) => resolved.startsWith(root))
        if (!isAuthorized) {
          return { behavior: 'deny' as const, message: 'Path not authorized for cron task' }
        }
      }
      return { behavior: 'allow' as const }
    },
  })

  try {
    const messageStream = query({ prompt: task.prompt, options })
    let result = ''
    for await (const message of messageStream) {
      if (message.type === 'assistant') {
        const blocks: Array<{ type: string; text?: string }> = (message as any).content ?? []
        for (const block of blocks) {
          if (block.type === 'text' && block.text) result += block.text
        }
      }
    }

    task.lastRunAt = Date.now()
    task.lastResult = result.substring(0, 500)
    persistTasks()

    const window = getMainWindow()
    if (window) {
      window.webContents.send('cron:taskCompleted', {
        taskId: task.id,
        result: task.lastResult
      })
    }
    notifyCronTaskComplete(task.name, task.lastResult || '')
  } catch (err) {
    task.lastRunAt = Date.now()
    task.lastResult = `Error: ${(err as Error).message}`
    persistTasks()
    console.error(`[CronManager] Task "${task.name}" failed:`, err)
    Sentry.captureException(err instanceof Error ? err : new Error(String(err)))
    const window = getMainWindow()
    if (window && !window.isDestroyed()) {
      window.webContents.send('agent:notification', {
        type: 'error',
        title: `定时任务失败: ${task.name}`,
        message: (err as Error).message || '未知错误',
      })
    }
  }
  } finally {
    runningTasks.delete(task.id)
  }
}

export async function executeTaskById(taskId: string): Promise<string> {
  const entry = tasks.get(taskId)
  if (!entry) throw new Error('Task not found')
  await executeTask(entry.task)
  return entry.task.lastResult || ''
}

export function stopAllCronJobs(): void {
  for (const [, entry] of tasks) {
    entry.job.stop()
  }
}
