import cron from 'node-cron'
import { query } from '@anthropic-ai/claude-agent-sdk'
import type { Options } from '@anthropic-ai/claude-agent-sdk'
import { getMainWindow } from './index'
import { getApiKey, getBaseUrl, getModel, getAuthorizedDirectories, getActiveProfile } from './store'
import { resolveClaudeCodeExecutable } from './agent-manager'
import { notifyCronTaskComplete } from './notification-manager'
import { join } from 'path'

interface CronTask {
  id: string
  name: string
  cronExpression: string
  prompt: string
  createdAt: number
  lastRunAt: number | null
  lastResult: string | null
  status: 'active' | 'paused'
}

const tasks = new Map<string, { task: CronTask; job: cron.ScheduledTask }>()

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
  })

  tasks.set(id, { task, job })
  return task
}

export function removeTask(taskId: string): boolean {
  const entry = tasks.get(taskId)
  if (!entry) return false
  entry.job.stop()
  tasks.delete(taskId)
  return true
}

export function listTasks(): CronTask[] {
  return Array.from(tasks.values()).map((e) => e.task)
}

export function getTask(taskId: string): CronTask | undefined {
  return tasks.get(taskId)?.task
}

export async function executeTask(task: CronTask): Promise<void> {
  const dirs = getAuthorizedDirectories()
  const cwd = dirs.length > 0 ? dirs[0] : process.cwd()
  const apiKey = getApiKey()
  const model = getModel()
  const baseUrl = getBaseUrl()
  const profile = getActiveProfile()
  const cliPath = resolveClaudeCodeExecutable()

  const env: Record<string, string> = {}
  if (apiKey) env.ANTHROPIC_API_KEY = apiKey
  if (baseUrl && profile?.apiProvider === 'custom') env.ANTHROPIC_BASE_URL = baseUrl

  const options: Options = {
    model,
    cwd,
    permissionMode: 'acceptEdits',
    env,
    allowedTools: ['Read', 'Glob', 'Grep', 'Write', 'Edit'],
    ...(cliPath ? { pathToClaudeCodeExecutable: cliPath } : {}),
    settings: {
      autoMemoryDirectory: join(cwd, '.vision', 'memory')
    },
    systemPrompt: {
      type: 'preset' as const,
      preset: 'claude_code' as const
    }
  }

  try {
    const messageStream = query({ prompt: task.prompt, options })
    let result = ''
    for await (const message of messageStream) {
      if (message.type === 'assistant') {
        for (const block of message.content) {
          if (block.type === 'text') result += block.text
        }
      }
    }

    task.lastRunAt = Date.now()
    task.lastResult = result.substring(0, 500)

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
  }
}

export async function executeTaskById(taskId: string): Promise<string> {
  const entry = tasks.get(taskId)
  if (!entry) throw new Error('Task not found')
  await executeTask(entry.task)
  return entry.task.lastResult || ''
}