import cron, { type ScheduledTask } from 'node-cron'
import { query } from '@anthropic-ai/claude-agent-sdk'
import * as Sentry from '@sentry/electron/main'
import { getMainWindow } from './ipc-sender'
import { getAuthorizedDirectories } from './persistence/workspace-store'
import { getCronTasks, saveCronTasks } from './persistence/settings-store'
import type { CronTask, CronTaskRegistration, CronTaskRun } from '../shared/cron-types'
import { buildAgentOptions } from './agent-options'
import { notifyCronTaskComplete } from './notification-manager'
import { extractToolPathInput, isToolUsePathAuthorized, toolRequiresPath } from './agent-path-utils'
import { normalizeCronLinkedUrls, sanitizeCronLinkedUrls } from '../shared/cron-linked-urls'

const MAX_RUN_HISTORY = 10

const tasks = new Map<string, { task: CronTask; job: ScheduledTask }>()
const runningTasks = new Map<string, AbortController>()

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value && value.trim()))))
}

function createRunId(taskId: string): string {
  return `${taskId}-run-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
}

function normalizeTask(task: CronTask): CronTask {
  const linkedUrls = sanitizeCronLinkedUrls(task.linkedUrls)
  return {
    ...task,
    linkedUrls,
    allowNetwork: linkedUrls.length > 0 || task.allowNetwork,
    resultHistory: task.resultHistory.slice(0, MAX_RUN_HISTORY),
  }
}

function persistTasks(): void {
  saveCronTasks(Array.from(tasks.values()).map((e) => e.task))
}

function withRuntimeState(task: CronTask): CronTask {
  return {
    ...task,
    isRunning: runningTasks.has(task.id),
  }
}

function scheduleTask(task: CronTask): ScheduledTask {
  const job = cron.schedule(task.cronExpression, () => executeTask(task), {
    scheduled: task.status !== 'paused'
  } as any)
  if (task.status === 'paused') job.stop()
  return job
}

function getTaskCwd(task: CronTask): string {
  const target = task.target
  if (target?.type === 'directory' && target.directoryPath) return target.directoryPath
  if ((target?.type === 'workspace' || target?.type === 'session') && target.workspacePath) return target.workspacePath
  const authorizedRoots = getAuthorizedDirectories()
  return authorizedRoots[0] || process.cwd()
}

function getTaskAuthorizedRoots(task: CronTask, cwd: string): string[] {
  const target = task.target
  return uniqueStrings([
    ...getAuthorizedDirectories(),
    cwd,
    target?.workspacePath,
    target?.directoryPath,
  ])
}

function buildTaskPrompt(task: CronTask): string {
  const target = task.target
  const context: string[] = ['你正在执行 sumi 自动化任务。']

  if (target?.type === 'session') {
    context.push(`关联会话：${target.sessionTitle || target.sessionId || '未命名会话'}`)
    if (target.workspacePath) context.push(`关联工作区：${target.workspacePath}`)
  } else if (target?.type === 'workspace' && target.workspacePath) {
    context.push(`关联工作区目录：${target.workspacePath}`)
  } else if (target?.type === 'directory' && target.directoryPath) {
    context.push(`关联目录：${target.directoryPath}`)
  }

  if (task.linkedUrls?.length) {
    context.push(`关联网址：\n${task.linkedUrls.map((url) => `- ${url}`).join('\n')}`)
    context.push('请优先访问并参考以上关联网址，再完成任务要求。访问关联网址时只能使用 WebFetch 或 WebSearch；禁止使用 Bash、curl、wget、浏览器 CLI 或其他命令行联网方式。')
  }

  context.push(task.allowNetwork ? '本任务允许联网检索。' : '本任务不允许联网检索。')

  return `${context.join('\n')}\n\n任务要求：\n${task.prompt}`
}

function recordRun(task: CronTask, run: CronTaskRun): void {
  task.lastRunAt = run.finishedAt
  task.lastStartedAt = run.startedAt
  task.lastFinishedAt = run.finishedAt
  task.lastStatus = run.status
  task.lastResult = run.result.substring(0, 500)
  task.lastError = run.error ?? null
  task.runCount = (task.runCount ?? 0) + 1
  task.resultHistory = [run, ...(task.resultHistory || [])].slice(0, MAX_RUN_HISTORY)
}

function notifyRendererTaskUpdated(task: CronTask, run?: CronTaskRun): void {
  const window = getMainWindow()
  if (!window || window.isDestroyed()) return
  window.webContents.send('cron:taskCompleted', {
    taskId: task.id,
    result: task.lastResult || '',
    task: withRuntimeState(task),
    run,
  })
}

function notifyInApp(task: CronTask, title: string, message: string, type: 'success' | 'error' | 'info' = 'success'): void {
  if (task.notifyOnCompletion === false) return
  const window = getMainWindow()
  if (!window || window.isDestroyed()) return
  window.webContents.send('agent:notification', {
    type,
    title,
    message,
    workspaceCwd: task.target?.workspacePath || task.target?.directoryPath || undefined,
    target: {
      view: 'automation',
      taskId: task.id,
      workspacePath: task.target?.workspacePath || task.target?.directoryPath || null,
    },
  })
}

export function restorePersistedTasks(): void {
  const persisted = getCronTasks()
  for (const rawTask of persisted) {
    const task = normalizeTask(rawTask)
    const job = scheduleTask(task)
    tasks.set(task.id, { task, job })
  }
  if (persisted.length > 0) persistTasks()
}

export function registerTask(registration: CronTaskRegistration): CronTask {
  const id = `cron-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  const prompt = registration.prompt.trim()
  const linkedUrls = normalizeCronLinkedUrls(registration.linkedUrls)
  const task: CronTask = normalizeTask({
    id,
    name: registration.name?.trim() || prompt.substring(0, 30) || '未命名自动化',
    cronExpression: registration.cronExpression,
    prompt,
    createdAt: Date.now(),
    lastRunAt: null,
    lastResult: null,
    status: 'active',
    target: registration.target ?? null,
    linkedUrls,
    allowNetwork: linkedUrls.length > 0 || (registration.allowNetwork ?? false),
    notifyOnCompletion: registration.notifyOnCompletion ?? true,
    lastStatus: null,
    lastError: null,
    lastStartedAt: null,
    lastFinishedAt: null,
    runCount: 0,
    resultHistory: [],
  })

  const job = scheduleTask(task)
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
  return Array.from(tasks.values()).map((e) => withRuntimeState(e.task))
}

export function getTask(taskId: string): CronTask | undefined {
  return tasks.get(taskId)?.task
}

export async function executeTask(task: CronTask): Promise<void> {
  if (runningTasks.has(task.id)) return
  const abortController = new AbortController()
  runningTasks.set(task.id, abortController)

  const startedAt = Date.now()
  task.lastStartedAt = startedAt
  task.lastStatus = null
  task.lastError = null
  persistTasks()
  notifyRendererTaskUpdated(task)

  try {
    const cwd = getTaskCwd(task)
    const authorizedRoots = getTaskAuthorizedRoots(task, cwd)
    const allowedTools = task.allowNetwork
      ? ['Read', 'Glob', 'Grep', 'Write', 'Edit', 'WebSearch', 'WebFetch']
      : ['Read', 'Glob', 'Grep', 'Write', 'Edit']
    const allowedToolNames = new Set(allowedTools)

    const options = buildAgentOptions({
      memoryMode: 'disabled',
      cwd,
      permissionMode: 'acceptEdits',
      // Bare allowedTools entries bypass canUseTool in recent SDK versions.
      // Keep this empty so every automation tool call reaches our whitelist
      // and session-scoped path authorization below.
      allowedTools: [],
      restrictiveBaseUrl: true,
      settingSources: [],
      skills: [],
      prependUserBinPaths: false,
      canUseTool: async (toolName, input) => {
        if (!allowedToolNames.has(toolName)) {
          return { behavior: 'deny' as const, message: 'Tool not allowed for automation task' }
        }
        const toolInput = typeof input === 'object' && input !== null ? input : {}
        const filePath = extractToolPathInput(toolName, toolInput)
        if (!filePath && toolRequiresPath(toolName)) {
          return { behavior: 'deny' as const, message: 'Missing path for automation task tool use' }
        }
        if (!isToolUsePathAuthorized(toolName, toolInput, authorizedRoots, { cwd })) {
          return { behavior: 'deny' as const, message: 'Path not authorized for automation task' }
        }
        return { behavior: 'allow' as const }
      },
    })

    const messageStream = query({
      prompt: buildTaskPrompt(task),
      options: {
        ...options,
        abortController,
      },
    })
    let result = ''
    for await (const message of messageStream) {
      if (message.type === 'result' && message.subtype === 'success') {
        result = message.result || ''
      }
    }
    if (abortController.signal.aborted) {
      throw new Error('Task aborted')
    }

    const run: CronTaskRun = {
      id: createRunId(task.id),
      startedAt,
      finishedAt: Date.now(),
      status: 'success',
      result: result || '任务已完成，但没有返回文本结果。',
      error: null,
    }
    recordRun(task, run)
    persistTasks()
    notifyRendererTaskUpdated(task, run)
    if (task.notifyOnCompletion !== false) {
      notifyCronTaskComplete(task.name, task.lastResult || '')
      notifyInApp(task, `自动化完成: ${task.name}`, task.lastResult || '任务已完成')
    }
  } catch (err) {
    const errorMessage = (err as Error).message || '未知错误'
    const wasCancelled = abortController.signal.aborted
    const run: CronTaskRun = {
      id: createRunId(task.id),
      startedAt,
      finishedAt: Date.now(),
      status: wasCancelled ? 'cancelled' : 'error',
      result: wasCancelled ? '任务已停止。' : `Error: ${errorMessage}`,
      error: wasCancelled ? '任务已停止' : errorMessage,
    }
    recordRun(task, run)
    persistTasks()
    if (!wasCancelled) {
      console.error(`[CronManager] Task "${task.name}" failed:`, err)
      Sentry.captureException(err instanceof Error ? err : new Error(String(err)))
    }
    notifyRendererTaskUpdated(task, run)
    notifyInApp(
      task,
      wasCancelled ? `自动化已停止: ${task.name}` : `自动化失败: ${task.name}`,
      wasCancelled ? '任务已停止' : errorMessage,
      wasCancelled ? 'info' : 'error'
    )
  } finally {
    runningTasks.delete(task.id)
    notifyRendererTaskUpdated(task)
  }
}

export async function executeTaskById(taskId: string): Promise<string> {
  const entry = tasks.get(taskId)
  if (!entry) throw new Error('Task not found')
  await executeTask(entry.task)
  return entry.task.lastResult || ''
}

export function stopTaskById(taskId: string): boolean {
  const controller = runningTasks.get(taskId)
  if (!controller) return false
  controller.abort()
  const entry = tasks.get(taskId)
  if (entry) notifyRendererTaskUpdated(entry.task)
  return true
}

export function setTaskStatus(taskId: string, status: CronTask['status']): CronTask {
  const entry = tasks.get(taskId)
  if (!entry) throw new Error('Task not found')

  entry.task.status = status
  if (status === 'paused') {
    entry.job.stop()
    const controller = runningTasks.get(taskId)
    if (controller) controller.abort()
  } else {
    entry.job.start()
  }

  persistTasks()
  notifyRendererTaskUpdated(entry.task)
  return withRuntimeState(entry.task)
}

export function stopAllCronJobs(): void {
  for (const [, entry] of tasks) {
    entry.job.stop()
  }
}
