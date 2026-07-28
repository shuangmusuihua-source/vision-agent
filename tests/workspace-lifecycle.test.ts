import { describe, expect, it, vi } from 'vitest'
import {
  WorkspaceLifecycle,
  type WorkspaceLifecycleDependencies,
} from '../src/main/workspace-lifecycle'

function createHarness(initialPaths = ['/work/a']) {
  let workspacePaths = [...initialPaths]
  const calls: string[] = []
  const taskSuspension = {
    taskIds: ['cron-a'],
    commitDeletion: vi.fn(() => { calls.push('commit-automation') }),
    rollback: vi.fn(() => { calls.push('rollback-automation') }),
  }
  const dependencies: WorkspaceLifecycleDependencies = {
    documentsRoot: () => '/documents/sumi',
    ensureDirectory: vi.fn(async () => undefined),
    createDirectory: vi.fn(async () => undefined),
    removeEmptyDirectory: vi.fn(async () => undefined),
    trashWorkspace: vi.fn(async () => { calls.push('trash') }),
    findRegisteredRoot: vi.fn((workspacePath) => (
      workspacePaths.includes(workspacePath) ? workspacePath : null
    )),
    isReservedWorkspace: vi.fn(() => false),
    getWorkspacePaths: () => [...workspacePaths],
    addWorkspace: vi.fn((workspacePath) => {
      workspacePaths = [workspacePath, ...workspacePaths]
    }),
    removeWorkspace: vi.fn((workspacePath) => {
      calls.push('persist')
      workspacePaths = workspacePaths.filter((path) => path !== workspacePath)
      return { removedSessionIds: ['session-a'] }
    }),
    reorderWorkspaces: vi.fn((nextPaths) => {
      if (nextPaths.length !== workspacePaths.length) return false
      workspacePaths = [...nextPaths]
      return true
    }),
    abortWorkspaceRuns: vi.fn(async () => { calls.push('abort-agent'); return ['session-a'] }),
    suspendWorkspaceTasks: vi.fn(async () => {
      calls.push('suspend-automation')
      return taskSuspension
    }),
    refreshIndex: vi.fn(async () => { calls.push('index') }),
  }

  return {
    lifecycle: new WorkspaceLifecycle(dependencies),
    dependencies,
    taskSuspension,
    calls,
    workspacePaths: () => workspacePaths,
  }
}

describe('WorkspaceLifecycle', () => {
  it('coordinates deletion through one serialized lifecycle', async () => {
    const harness = createHarness()

    const result = await harness.lifecycle.delete('/work/a')

    expect(result).toEqual({
      success: true,
      workspacePath: '/work/a',
      workspacePaths: [],
      removedSessionIds: ['session-a'],
      pausedTaskIds: ['cron-a'],
    })
    expect(harness.calls).toEqual([
      'abort-agent',
      'suspend-automation',
      'trash',
      'persist',
      'commit-automation',
      'index',
    ])
  })

  it('rolls automation schedules back when moving the workspace to Trash fails', async () => {
    const harness = createHarness()
    vi.mocked(harness.dependencies.trashWorkspace)
      .mockRejectedValueOnce(new Error('Trash unavailable'))

    const result = await harness.lifecycle.delete('/work/a')

    expect(result).toMatchObject({
      success: false,
      code: 'filesystem_error',
      workspacePaths: ['/work/a'],
    })
    expect(harness.taskSuspension.rollback).toHaveBeenCalledOnce()
    expect(harness.dependencies.removeWorkspace).not.toHaveBeenCalled()
  })

  it('coalesces concurrent deletion requests for the same workspace', async () => {
    const harness = createHarness()
    let releaseTrash!: () => void
    vi.mocked(harness.dependencies.trashWorkspace).mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => { releaseTrash = resolve })
    })

    const first = harness.lifecycle.delete('/work/a')
    const second = harness.lifecycle.delete('/work/a/')
    expect(second).toBe(first)

    await vi.waitFor(() => {
      expect(harness.dependencies.trashWorkspace).toHaveBeenCalledOnce()
    })
    releaseTrash()
    await expect(Promise.all([first, second])).resolves.toHaveLength(2)
    expect(harness.dependencies.removeWorkspace).toHaveBeenCalledOnce()
  })

  it('returns structured create errors and uses non-recursive creation as the ownership decision', async () => {
    const harness = createHarness([])
    const alreadyExists = Object.assign(new Error('exists'), { code: 'EEXIST' })
    vi.mocked(harness.dependencies.createDirectory).mockRejectedValueOnce(alreadyExists)

    await expect(harness.lifecycle.create('Research')).resolves.toEqual({
      success: false,
      code: 'already_exists',
      error: '工作区已存在，请使用其他名称',
      workspacePaths: [],
    })
    expect(harness.dependencies.addWorkspace).not.toHaveBeenCalled()
  })

  it('creates, persists, indexes, and projects one canonical workspace result', async () => {
    const harness = createHarness([])

    await expect(harness.lifecycle.create('Research')).resolves.toEqual({
      success: true,
      workspacePath: '/documents/sumi/Research',
      workspacePaths: ['/documents/sumi/Research'],
    })
    expect(harness.dependencies.ensureDirectory).toHaveBeenCalledWith('/documents/sumi')
    expect(harness.dependencies.createDirectory).toHaveBeenCalledWith('/documents/sumi/Research')
    expect(harness.dependencies.refreshIndex).toHaveBeenCalledWith(['/documents/sumi/Research'])
  })

  it('rejects stale reorder requests and returns the canonical order', async () => {
    const harness = createHarness(['/work/a', '/work/b'])

    await expect(harness.lifecycle.reorder(['/work/a'])).resolves.toEqual({
      success: false,
      code: 'invalid_order',
      error: '工作区列表已发生变化，请重试',
      workspacePaths: ['/work/a', '/work/b'],
    })
  })

  it('serializes a valid reorder and returns the persisted canonical order', async () => {
    const harness = createHarness(['/work/a', '/work/b'])

    await expect(harness.lifecycle.reorder(['/work/b', '/work/a'])).resolves.toEqual({
      success: true,
      workspacePaths: ['/work/b', '/work/a'],
    })
    expect(harness.dependencies.refreshIndex).toHaveBeenCalledWith(['/work/b', '/work/a'])
  })
})
