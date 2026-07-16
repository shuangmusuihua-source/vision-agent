import { afterEach, describe, expect, it, vi } from 'vitest'
import { EditorProjectionScheduler } from '../src/renderer/components/editor/editor-projection-scheduler'
import { SourceSaveController } from '../src/renderer/components/editor/source-save-controller'

afterEach(() => {
  vi.useRealTimers()
})

describe('EditorProjectionScheduler', () => {
  it('coalesces rapid transactions and projects only the latest immutable snapshot', () => {
    vi.useFakeTimers()
    const project = vi.fn()
    const scheduler = new EditorProjectionScheduler(project, 120)

    scheduler.schedule({ version: 1 })
    scheduler.schedule({ version: 2 })
    scheduler.schedule({ version: 3 })
    vi.advanceTimersByTime(119)

    expect(project).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(project).toHaveBeenCalledTimes(1)
    expect(project).toHaveBeenCalledWith({ version: 3 })
  })

  it('flushes the captured old-document snapshot before a tab switch', () => {
    vi.useFakeTimers()
    const project = vi.fn()
    const scheduler = new EditorProjectionScheduler(project, 120)
    const oldDocument = { owner: 'old-tab' }

    scheduler.schedule(oldDocument)

    expect(scheduler.flush()).toBe(true)
    expect(project).toHaveBeenCalledWith(oldDocument)
    expect(scheduler.flush()).toBe(false)

    vi.advanceTimersByTime(120)
    expect(project).toHaveBeenCalledTimes(1)
  })

  it('projects at most once per interval during continuous updates', () => {
    vi.useFakeTimers()
    const project = vi.fn()
    const scheduler = new EditorProjectionScheduler(project, 120)

    scheduler.schedule(1)
    vi.advanceTimersByTime(60)
    scheduler.schedule(2)
    vi.advanceTimersByTime(60)
    expect(project).toHaveBeenNthCalledWith(1, 2)

    scheduler.schedule(3)
    vi.advanceTimersByTime(120)
    expect(project).toHaveBeenNthCalledWith(2, 3)
  })

  it('projects before an explicit async save flush', async () => {
    vi.useFakeTimers()
    const save = vi.fn()
    const saveController = new SourceSaveController(save, 1500)
    const scheduler = new EditorProjectionScheduler(
      (snapshot: { path: string; markdown: string }) => {
        saveController.schedule(snapshot.path, snapshot.markdown)
      },
      120,
    )
    scheduler.schedule({ path: '/workspace/old.md', markdown: 'latest' })

    scheduler.flush()
    await expect(saveController.flushAsync()).resolves.toBe(true)

    expect(save).toHaveBeenCalledWith('/workspace/old.md', 'latest')
  })
})
