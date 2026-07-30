import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CronExecuteResponse } from '../src/shared/cron-types'

type IPCHandler = (_event: unknown, ...args: unknown[]) => unknown

async function loadCronExecuteHandler(options: {
  outcome?: CronExecuteResponse
  error?: Error
}): Promise<IPCHandler> {
  vi.resetModules()
  const handlers = new Map<string, IPCHandler>()
  const executeTaskById = options.error
    ? vi.fn().mockRejectedValue(options.error)
    : vi.fn().mockResolvedValue(options.outcome)

  vi.doMock('electron', () => ({
    dialog: { showOpenDialog: vi.fn() },
    ipcMain: {
      handle: vi.fn((channel: string, handler: IPCHandler) => {
        handlers.set(channel, handler)
      }),
    },
  }))
  vi.doMock('../src/main/cron-manager', () => ({
    executeTaskById,
    listTasks: vi.fn(),
    registerTask: vi.fn(),
    removeTask: vi.fn(),
    setTaskStatus: vi.fn(),
    stopTaskById: vi.fn(),
  }))
  vi.doMock('../src/main/cron-schedule-parser', () => ({
    resolveCronSchedule: vi.fn(),
  }))
  vi.doMock('../src/main/ipc-sender', () => ({
    getMainWindow: vi.fn(),
  }))
  vi.doMock('../src/main/directory-grants', () => ({
    rememberSelectedDirectoryGrant: vi.fn(),
  }))

  const { registerCronHandlers } = await import('../src/main/handlers/cron-handlers')
  registerCronHandlers()
  const handler = handlers.get('cron:execute')
  if (!handler) throw new Error('cron:execute handler was not registered')
  return handler
}

describe('cron execute IPC outcome', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('forwards the concrete execution outcome without rewriting it as success', async () => {
    const outcome: CronExecuteResponse = {
      status: 'error',
      error: 'Model request failed',
      run: {
        id: 'run-1',
        startedAt: 1,
        finishedAt: 2,
        status: 'error',
        result: 'Error: Model request failed',
        error: 'Model request failed',
      },
    }
    const handler = await loadCronExecuteHandler({ outcome })

    await expect(handler({}, 'task-1')).resolves.toEqual(outcome)
  })

  it('returns rejected only when the execution request itself cannot be handled', async () => {
    const handler = await loadCronExecuteHandler({
      error: new Error('Task not found'),
    })

    await expect(handler({}, 'missing-task')).resolves.toEqual({
      status: 'rejected',
      error: 'Task not found',
    })
  })
})
