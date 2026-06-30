import { afterEach, describe, expect, it, vi } from 'vitest'
import { SourceSaveController } from '../src/renderer/components/editor/source-save-controller'

afterEach(() => {
  vi.useRealTimers()
})

describe('SourceSaveController', () => {
  it('debounces source edits and saves only the latest content', () => {
    vi.useFakeTimers()
    const save = vi.fn()
    const controller = new SourceSaveController(save, 1500)

    controller.schedule('/workspace/a.md', 'first')
    vi.advanceTimersByTime(1000)
    controller.schedule('/workspace/a.md', 'second')
    vi.advanceTimersByTime(1499)

    expect(save).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)

    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith('/workspace/a.md', 'second')
    expect(controller.hasPendingSave()).toBe(false)
  })

  it('flushes pending source edits immediately without a duplicate timer save', () => {
    vi.useFakeTimers()
    const save = vi.fn()
    const controller = new SourceSaveController(save, 1500)

    controller.schedule('/workspace/a.md', 'draft')

    expect(controller.flush()).toBe(true)
    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith('/workspace/a.md', 'draft')

    vi.advanceTimersByTime(1500)

    expect(save).toHaveBeenCalledTimes(1)
    expect(controller.flush()).toBe(false)
  })

  it('discards pending source edits on file switches when there is nothing left to save', () => {
    vi.useFakeTimers()
    const save = vi.fn()
    const controller = new SourceSaveController(save, 1500)

    controller.schedule('/workspace/a.md', 'draft')
    controller.discard()
    vi.advanceTimersByTime(1500)

    expect(save).not.toHaveBeenCalled()
    expect(controller.hasPendingSave()).toBe(false)
  })

  it('uses the latest save handler when the React prop changes', () => {
    vi.useFakeTimers()
    const firstSave = vi.fn()
    const nextSave = vi.fn()
    const controller = new SourceSaveController(firstSave, 1500)

    controller.schedule('/workspace/a.md', 'draft')
    controller.setSaveHandler(nextSave)
    vi.advanceTimersByTime(1500)

    expect(firstSave).not.toHaveBeenCalled()
    expect(nextSave).toHaveBeenCalledWith('/workspace/a.md', 'draft')
  })

  it('flushes the captured file before a tab switch cancels its debounce', () => {
    vi.useFakeTimers()
    const save = vi.fn()
    const controller = new SourceSaveController(save, 1500)

    controller.schedule('/workspace/old.md', 'unsaved edit')

    expect(controller.flush()).toBe(true)
    expect(save).toHaveBeenCalledWith('/workspace/old.md', 'unsaved edit')

    controller.schedule('/workspace/new.md', 'new tab edit')
    vi.advanceTimersByTime(1500)

    expect(save).toHaveBeenNthCalledWith(2, '/workspace/new.md', 'new tab edit')
  })

  it('awaits an explicit flush before a file-system mutation continues', async () => {
    vi.useFakeTimers()
    let finishSave: (() => void) | undefined
    const save = vi.fn(() => new Promise<void>((resolve) => { finishSave = resolve }))
    const controller = new SourceSaveController(save, 1500)
    controller.schedule('/workspace/a.md', 'latest')

    let settled = false
    const flush = controller.flushAsync().then((result) => {
      settled = true
      return result
    })
    await Promise.resolve()

    expect(save).toHaveBeenCalledWith('/workspace/a.md', 'latest')
    expect(settled).toBe(false)

    finishSave?.()
    await expect(flush).resolves.toBe(true)
    expect(controller.hasPendingSave()).toBe(false)
  })

  it('waits for a save already started by a synchronous cleanup flush', async () => {
    let finishSave: (() => void) | undefined
    const save = vi.fn(() => new Promise<void>((resolve) => { finishSave = resolve }))
    const controller = new SourceSaveController(save, 1500)
    controller.schedule('/workspace/a.md', 'latest')

    expect(controller.flush()).toBe(true)
    let settled = false
    const waitForSave = controller.flushAsync().then(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)

    finishSave?.()
    await waitForSave
    expect(settled).toBe(true)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('rejects an explicit flush when persistence reports failure', async () => {
    const controller = new SourceSaveController(
      vi.fn().mockResolvedValue({ success: false, error: 'disk full' }),
      1500,
    )
    controller.schedule('/workspace/a.md', 'latest')

    await expect(controller.flushAsync()).rejects.toThrow('disk full')
  })
})
