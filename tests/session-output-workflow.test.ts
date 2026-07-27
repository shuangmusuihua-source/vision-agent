import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionOutputEntry, SessionOutputs } from '../src/shared/types'
import { SessionOutputWorkflow } from '../src/renderer/workflows/session-output-workflow'

const outputFile: SessionOutputEntry = {
  fileName: 'report.md',
  filePath: '/workspace/.sumi/sessions/a/report.md',
  relativePath: 'report.md',
  fileType: 'markdown',
  category: 'document',
  availability: 'available',
  createdAt: 1,
  modifiedAt: 1,
}

function outputs(sessionId: string, fileName = 'report.md'): SessionOutputs {
  return {
    sessionId,
    workspacePath: '/workspace',
    files: [{ ...outputFile, fileName }],
  }
}

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function createHarness() {
  let activeSessionId: string | null = 'session-a'
  const projected: Array<SessionOutputs | null> = []
  const loading: boolean[] = []
  const list = vi.fn<(sessionId: string) => Promise<SessionOutputs | null>>()
  const addToKnowledge = vi.fn(async () => ({ success: true }))
  const reveal = vi.fn(async () => ({ success: true }))
  const open = vi.fn(async () => ({ success: true }))
  const remove = vi.fn(async () => ({ success: true }))
  const confirmDelete = vi.fn(async () => true)
  const alert = vi.fn(async () => {})
  const workflow = new SessionOutputWorkflow({
    getActiveSessionId: () => activeSessionId,
    list,
    setOutputs: (value) => projected.push(value),
    setLoading: (value) => loading.push(value),
    addToKnowledge,
    reveal,
    open,
    delete: remove,
    confirmDelete,
    alert,
  })

  return {
    workflow,
    list,
    projected,
    loading,
    addToKnowledge,
    reveal,
    open,
    remove,
    confirmDelete,
    alert,
    setActiveSessionId: (sessionId: string | null) => { activeSessionId = sessionId },
  }
}

describe('session output workflow module', () => {
  beforeEach(() => vi.useFakeTimers())

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('projects only the latest request for the active session', async () => {
    const harness = createHarness()
    const first = deferred<SessionOutputs | null>()
    const second = deferred<SessionOutputs | null>()
    harness.list.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)

    harness.workflow.activateSession('session-a')
    harness.workflow.activateSession('session-a')
    first.resolve(outputs('session-a', 'old.md'))
    await Promise.resolve()
    second.resolve(outputs('session-a', 'new.md'))
    await Promise.resolve()

    expect(harness.loading).toEqual([true, true])
    expect(harness.projected).toEqual([outputs('session-a', 'new.md')])
  })

  it('does not project a response after the active session changes', async () => {
    const harness = createHarness()
    const request = deferred<SessionOutputs | null>()
    harness.list.mockReturnValueOnce(request.promise)

    harness.workflow.activateSession('session-a')
    harness.setActiveSessionId('session-b')
    request.resolve(outputs('session-a'))
    await Promise.resolve()

    expect(harness.projected).toEqual([])
  })

  it('debounces file changes and agent completion through the same refresh seam', async () => {
    const harness = createHarness()
    harness.list.mockResolvedValue(outputs('session-a'))

    harness.workflow.sessionFilesChanged('session-a')
    harness.workflow.sessionFilesChanged('session-a')
    harness.workflow.agentFinished('session-a')
    await vi.advanceTimersByTimeAsync(120)

    expect(harness.list).toHaveBeenCalledTimes(1)
    expect(harness.projected).toEqual([outputs('session-a')])
  })

  it('owns successful knowledge and delete refreshes', async () => {
    const harness = createHarness()
    harness.list.mockResolvedValue(outputs('session-a'))

    await expect(harness.workflow.addToKnowledge(outputFile.filePath)).resolves.toEqual({ success: true })
    await expect(harness.workflow.delete(outputFile)).resolves.toBe(true)

    expect(harness.addToKnowledge).toHaveBeenCalledWith(outputFile.filePath, 'session-a')
    expect(harness.remove).toHaveBeenCalledWith('session-a', outputFile.filePath)
    expect(harness.list).toHaveBeenCalledTimes(2)
  })

  it('reports action failures without refreshing', async () => {
    const harness = createHarness()
    harness.open.mockResolvedValueOnce({ success: false, error: 'no opener' })
    harness.remove.mockResolvedValueOnce({ success: false, error: 'locked' })

    await harness.workflow.open(outputFile.filePath)
    await expect(harness.workflow.delete(outputFile)).resolves.toBe(false)

    expect(harness.alert).toHaveBeenNthCalledWith(1, '无法打开产物', 'no opener')
    expect(harness.alert).toHaveBeenNthCalledWith(2, '删除失败', 'locked')
    expect(harness.list).not.toHaveBeenCalled()
  })
})
