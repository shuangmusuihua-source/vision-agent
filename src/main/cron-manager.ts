import cron, { type ScheduledTask } from 'node-cron'
import { query, type SDKResultMessage } from '@anthropic-ai/claude-agent-sdk'
import * as Sentry from '@sentry/electron/main'
import { getMainWindow } from './ipc-sender'
import { getAuthorizedDirectories, getSessionRecordById } from './persistence/workspace-store'
import { getCronTasks, saveCronTasks } from './persistence/settings-store'
import type { CronTask, CronTaskRegistration, CronTaskRun, CronTaskTarget } from '../shared/cron-types'
import { buildAgentOptions } from './agent-options'
import { notifyCronTaskComplete } from './notification-manager'
import { extractToolPathInput, isExactAuthorizedRoot, isToolUsePathAuthorized, toolRequiresPath } from './agent-path-utils'
import { normalizeCronLinkedUrls, sanitizeCronLinkedUrls } from '../shared/cron-linked-urls'
import { canonicalGrantedDirectory, consumeSelectedDirectoryGrant } from './directory-grants'
import { tmpdir } from 'os'
import { join } from 'path'
import { mkdir } from 'fs/promises'

const MAX_RUN_HISTORY = 10

const tasks = new Map<string, { task: CronTask; job: ScheduledTask }>()
const runningTasks = new Map<string, AbortController>()

function describeAutomationResultError(result: Exclude<SDKResultMessage, { subtype: 'success' }>): string {
  const details = result.errors.map((error) => error.trim()).filter(Boolean)
  if (details.length > 0) return details.join('\n')

  switch (result.subtype) {
    case 'error_max_turns':
      return 'Agent reached the maximum number of turns'
    case 'error_max_budget_usd':
      return 'Agent reached the configured budget limit'
    case 'error_max_structured_output_retries':
      return 'Agent could not produce valid structured output'
    case 'error_during_execution':
      return 'Agent execution failed'
  }
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

function matchingWorkspaceRoot(workspacePath: string): string | null {
  return getAuthorizedDirectories().find((root) => isExactAuthorizedRoot(workspacePath, [root])) || null
}

function normalizeTaskTarget(target: CronTaskTarget | null | undefined, consumeDirectoryGrant: boolean): CronTaskTarget | null {
  if (!target) return null

  if (target.type === 'workspace') {
    if (!target.workspacePath) throw new Error('Automation workspace target is missing a path')
    const workspacePath = matchingWorkspaceRoot(target.workspacePath)
    if (!workspacePath) throw new Error('Automation workspace target is not authorized')
    return { ...target, workspacePath }
  }

  if (target.type === 'session') {
    if (!target.sessionId) throw new Error('Automation session target is missing a session ID')
    const record = getSessionRecordById(target.sessionId)
    if (!record || record.context !== 'editor') throw new Error('Automation session target is not available')
    const workspacePath = matchingWorkspaceRoot(record.workspacePath)
    if (!workspacePath) throw new Error('Automation session workspace is not authorized')
    return {
      ...target,
      workspacePath,
      sessionTitle: record.title || target.sessionTitle,
    }
  }

  if (!target.directoryPath) throw new Error('Automation directory target is missing a path')
  if (consumeDirectoryGrant && !consumeSelectedDirectoryGrant(target.directoryPath)) {
    throw new Error('Automation directory target must be selected again')
  }
  return { ...target, directoryPath: canonicalGrantedDirectory(target.directoryPath) }
}

function getTaskCwd(task: CronTask): string {
  const target = task.target
  if (target?.type === 'directory' && target.directoryPath) return target.directoryPath
  if ((target?.type === 'workspace' || target?.type === 'session') && target.workspacePath) return target.workspacePath
  return join(tmpdir(), 'sumi-automation', task.id)
}

function getTaskAuthorizedRoots(_task: CronTask, cwd: string): string[] {
  return [cwd]
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
    let task: CronTask
    try {
      task = normalizeTask({ ...rawTask, target: normalizeTaskTarget(rawTask.target, false) })
    } catch (error) {
      task = normalizeTask({
        ...rawTask,
        status: 'paused',
        lastError: error instanceof Error ? error.message : String(error),
      })
    }
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
    target: normalizeTaskTarget(registration.target, true),
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
  runningTasks.get(taskId)?.abort()
  tasks.delete(taskId)
  persistTasks()
  return true
}

export function listTasks(): CronTask[] {
  return Array.from(tasks.values()).map((e) => withRuntimeState(e.task))
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
    task.target = normalizeTaskTarget(task.target, false)
    const cwd = getTaskCwd(task)
    if (!task.target) await mkdir(cwd, { recursive: true })
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
    let terminalResult: SDKResultMessage | null = null
    for await (const message of messageStream) {
      if (message.type === 'result') terminalResult = message
    }
    if (abortController.signal.aborted) {
      throw new Error('Task aborted')
    }
    if (!terminalResult) throw new Error('Agent did not return a terminal result')
    if (terminalResult.subtype !== 'success') {
      throw new Error(describeAutomationResultError(terminalResult))
    }

    const run: CronTaskRun = {
      id: createRunId(task.id),
      startedAt,
      finishedAt: Date.now(),
      status: 'success',
      result: terminalResult.result || '任务已完成，但没有返回文本结果。',
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
    if (!tasks.has(task.id)) return
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
    if (tasks.has(task.id)) notifyRendererTaskUpdated(task)
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

  if (status === 'active') {
    entry.task.target = normalizeTaskTarget(entry.task.target, false)
  }
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
  for (const controller of runningTasks.values()) controller.abort()
}
