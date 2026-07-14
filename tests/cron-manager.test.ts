import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CronTask } from '../src/shared/cron-types'

type LoadedCronManager = {
  manager: typeof import('../src/main/cron-manager')
  savedTasks: () => CronTask[]
  schedule: ReturnType<typeof vi.fn>
  query: ReturnType<typeof vi.fn>
  buildAgentOptions: ReturnType<typeof vi.fn>
  notifyCronTaskComplete: ReturnType<typeof vi.fn>
  sentEvents: unknown[][]
  isToolUsePathAuthorized: ReturnType<typeof vi.fn>
}

async function loadCronManager(options?: {
  persisted?: CronTask[]
  authorizedDirectories?: string[]
  queryImpl?: (args: any) => AsyncGenerator<any, void, unknown>
}): Promise<LoadedCronManager> {
  vi.resetModules()

  let savedTasks: CronTask[] = []
  const schedule = vi.fn(() => ({ stop: vi.fn(), start: vi.fn() }))
  const query = vi.fn(options?.queryImpl || async function* queryMock() {
    yield { type: 'result', subtype: 'success', result: 'done' }
  })
  const buildAgentOptions = vi.fn((profile) => profile)
  const notifyCronTaskComplete = vi.fn()
  const sentEvents: unknown[][] = []
  const isToolUsePathAuthorized = vi.fn(() => true)

  vi.doMock('node-cron', () => ({
    default: { schedule },
  }))

  vi.doMock('@anthropic-ai/claude-agent-sdk', () => ({ query }))
  vi.doMock('@sentry/electron/main', () => ({ captureException: vi.fn() }))
  vi.doMock('../src/main/ipc-sender', () => ({
    getMainWindow: () => ({
      isDestroyed: () => false,
      webContents: {
        send: (...args: unknown[]) => sentEvents.push(args),
      },
    }),
  }))
  vi.doMock('../src/main/persistence/workspace-store', () => ({
    getAuthorizedDirectories: () => options?.authorizedDirectories || ['/tmp/workspace'],
    getSessionRecordById: () => undefined,
  }))
  vi.doMock('../src/main/persistence/settings-store', () => ({
    getCronTasks: () => options?.persisted || [],
    saveCronTasks: (tasks: CronTask[]) => { savedTasks = tasks },
  }))
  vi.doMock('../src/main/agent-options', () => ({ buildAgentOptions }))
  vi.doMock('../src/main/notification-manager', () => ({ notifyCronTaskComplete }))
  vi.doMock('../src/main/agent-path-utils', () => ({
    extractToolPathInput: vi.fn(() => null),
    isExactAuthorizedRoot: vi.fn((path: string, roots: string[]) => roots.includes(path)),
    isToolUsePathAuthorized,
    toolRequiresPath: vi.fn(() => false),
  }))
  vi.doMock('../src/main/directory-grants', () => ({
    canonicalGrantedDirectory: (path: string) => path,
    consumeSelectedDirectoryGrant: () => true,
  }))

  const manager = await import('../src/main/cron-manager')
  return {
    manager,
    savedTasks: () => savedTasks,
    schedule,
    query,
    buildAgentOptions,
    notifyCronTaskComplete,
    sentEvents,
    isToolUsePathAuthorized,
  }
}

describe('cron manager automation tasks', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('registers automation metadata and persists the task', async () => {
    const { manager, savedTasks, schedule } = await loadCronManager()

    const task = manager.registerTask({
      name: 'weekly scan',
      cronExpression: '0 9 * * 1',
      prompt: 'scan files',
      allowNetwork: true,
      notifyOnCompletion: false,
      target: {
        type: 'workspace',
        workspacePath: '/tmp/workspace',
        workspaceName: 'workspace',
      },
    })

    expect(task.name).toBe('weekly scan')
    expect(task.allowNetwork).toBe(true)
    expect(task.notifyOnCompletion).toBe(false)
    expect(task.target?.type).toBe('workspace')
    expect(savedTasks()).toHaveLength(1)
    expect(savedTasks()[0].target?.workspacePath).toBe('/tmp/workspace')
    expect(schedule).toHaveBeenCalledWith('0 9 * * 1', expect.any(Function), { scheduled: true })
  })

  it('executes with target cwd, network tools, and run history', async () => {
    const { manager, query, buildAgentOptions, notifyCronTaskComplete, sentEvents, isToolUsePathAuthorized } = await loadCronManager()
    const task = manager.registerTask({
      cronExpression: '0 9 * * *',
      prompt: 'summarize updates',
      linkedUrls: ['https://example.com/updates'],
      allowNetwork: false,
      target: {
        type: 'directory',
        directoryPath: '/tmp/automation-target',
      },
    })

    await manager.executeTaskById(task.id)

    expect(buildAgentOptions).toHaveBeenCalledWith(expect.objectContaining({
      cwd: '/tmp/automation-target',
      allowedTools: [],
      settingSources: [],
      skills: [],
    }))
    const profile = buildAgentOptions.mock.calls[0][0]
    await expect(profile.canUseTool('WebFetch', {})).resolves.toEqual(expect.objectContaining({ behavior: 'allow' }))
    await expect(profile.canUseTool('Read', { file_path: '/tmp/automation-target/report.md' })).resolves.toEqual(expect.objectContaining({ behavior: 'allow' }))
    await expect(profile.canUseTool('Bash', {})).resolves.toEqual(expect.objectContaining({ behavior: 'deny' }))
    expect(isToolUsePathAuthorized).toHaveBeenCalledWith(
      'Read',
      { file_path: '/tmp/automation-target/report.md' },
      ['/tmp/automation-target'],
      { cwd: '/tmp/automation-target' },
    )
    expect(query).toHaveBeenCalledWith(expect.objectContaining({
      prompt: expect.stringMatching(/https:\/\/example\.com\/updates[\s\S]*只能使用 WebFetch 或 WebSearch[\s\S]*summarize updates/),
      options: expect.objectContaining({
        cwd: '/tmp/automation-target',
        abortController: expect.any(AbortController),
      }),
    }))
    expect(task.allowNetwork).toBe(true)
    expect(task.lastStatus).toBe('success')
    expect(task.runCount).toBe(1)
    expect(task.resultHistory?.[0]).toEqual(expect.objectContaining({
      status: 'success',
      result: 'done',
    }))
    expect(sentEvents.some((event) => event[0] === 'cron:taskCompleted')).toBe(true)
    expect(notifyCronTaskComplete).toHaveBeenCalledWith(task.name, 'done')
  })

  it('stops a running task and records a cancelled run', async () => {
    let releaseReady!: () => void
    const ready = new Promise<void>((resolve) => { releaseReady = resolve })
    const queryImpl = async function* queryMock(args: { options: { abortController: AbortController } }) {
      releaseReady()
      await new Promise<void>((_resolve, reject) => {
        args.options.abortController.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
      })
    }

    const { manager } = await loadCronManager({ queryImpl })
    const task = manager.registerTask({
      cronExpression: '*/5 * * * *',
      prompt: 'watch files',
    })

    const pending = manager.executeTaskById(task.id)
    await ready

    expect(manager.listTasks()[0].isRunning).toBe(true)
    expect(manager.stopTaskById(task.id)).toBe(true)
    await pending

    const [stoppedTask] = manager.listTasks()
    expect(stoppedTask.isRunning).toBe(false)
    expect(stoppedTask.lastStatus).toBe('cancelled')
    expect(stoppedTask.resultHistory?.[0]).toEqual(expect.objectContaining({
      status: 'cancelled',
      result: '任务已停止。',
    }))
  })

  it('aborts a running task when it is removed', async () => {
    let releaseReady!: () => void
    const ready = new Promise<void>((resolve) => { releaseReady = resolve })
    const queryImpl = async function* queryMock(args: { options: { abortController: AbortController } }) {
      releaseReady()
      await new Promise<void>((_resolve, reject) => {
        args.options.abortController.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
      })
    }
    const { manager } = await loadCronManager({ queryImpl })
    const task = manager.registerTask({ cronExpression: '*/5 * * * *', prompt: 'watch files' })
    const pending = manager.executeTaskById(task.id)
    await ready

    expect(manager.removeTask(task.id)).toBe(true)
    await pending
    expect(manager.listTasks()).toEqual([])
  })

  it('isolates untargeted tasks in separate scratch directories', async () => {
    const { manager, buildAgentOptions } = await loadCronManager()
    const first = manager.registerTask({ cronExpression: '0 1 * * *', prompt: 'first' })
    const second = manager.registerTask({ cronExpression: '0 2 * * *', prompt: 'second' })

    await manager.executeTaskById(first.id)
    await manager.executeTaskById(second.id)

    const firstCwd = buildAgentOptions.mock.calls[0][0].cwd as string
    const secondCwd = buildAgentOptions.mock.calls[1][0].cwd as string
    expect(firstCwd).toContain(first.id)
    expect(secondCwd).toContain(second.id)
    expect(firstCwd).not.toBe(secondCwd)
  })

  it('pauses and resumes the recurring schedule', async () => {
    const { manager, savedTasks, schedule } = await loadCronManager()
    const task = manager.registerTask({
      cronExpression: '0 9 * * *',
      prompt: 'daily digest',
    })
    const job = schedule.mock.results[0].value

    const paused = manager.setTaskStatus(task.id, 'paused')
    expect(paused.status).toBe('paused')
    expect(job.stop).toHaveBeenCalled()
    expect(savedTasks()[0].status).toBe('paused')

    const active = manager.setTaskStatus(task.id, 'active')
    expect(active.status).toBe('active')
    expect(job.start).toHaveBeenCalled()
    expect(savedTasks()[0].status).toBe('active')
  })
})
