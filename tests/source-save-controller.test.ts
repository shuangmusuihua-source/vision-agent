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

  it('keeps the save handler that owned the edit when React props change', () => {
    vi.useFakeTimers()
    const firstSave = vi.fn()
    const nextSave = vi.fn()
    const controller = new SourceSaveController(firstSave, 1500)

    controller.schedule('/workspace/a.md', 'draft')
    controller.setSaveHandler(nextSave)
    vi.advanceTimersByTime(1500)

    expect(firstSave).toHaveBeenCalledWith('/workspace/a.md', 'draft')
    expect(nextSave).not.toHaveBeenCalled()

    controller.schedule('/workspace/b.md', 'next draft')
    vi.advanceTimersByTime(1500)
    expect(nextSave).toHaveBeenCalledWith('/workspace/b.md', 'next draft')
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

  it.each(['result', 'rejection'] as const)('keeps the latest draft retryable when an older save fails via %s', async (failure) => {
    vi.useFakeTimers()
    let failOldSave!: () => void
    const oldSave = new Promise<unknown>((resolve, reject) => {
      failOldSave = () => failure === 'result'
        ? resolve({ success: false, error: 'disk full' })
        : reject(new Error('disk full'))
    })
    const save = vi.fn().mockReturnValueOnce(oldSave).mockResolvedValue({ success: true })
    const controller = new SourceSaveController(save)
    controller.schedule('/workspace/a.md', 'old')
    controller.flush()
    controller.schedule('/workspace/a.md', 'latest')

    const flushing = controller.flushAsync()
    const failureAssertion = expect(flushing).rejects.toThrow('disk full')
    expect(controller.hasPendingSave()).toBe(true)
    await vi.advanceTimersByTimeAsync(1500)
    expect(save).toHaveBeenCalledTimes(1)
    failOldSave()
    await failureAssertion

    expect(controller.hasPendingSave()).toBe(true)
    await expect(controller.flushAsync()).resolves.toBe(true)
    expect(save).toHaveBeenLastCalledWith('/workspace/a.md', 'latest')
    expect(controller.hasPendingSave()).toBe(false)
  })

  it('saves the newest edit with its original owner after waiting for an earlier save', async () => {
    vi.useFakeTimers()
    let finishOldSave!: () => void
    const oldSave = new Promise<void>((resolve) => { finishOldSave = resolve })
    const ownerSave = vi.fn().mockReturnValueOnce(oldSave).mockResolvedValue({ success: true })
    const otherOwnerSave = vi.fn()
    const controller = new SourceSaveController(ownerSave)
    controller.schedule('/workspace/a.md', 'old')
    controller.flush()
    controller.schedule('/workspace/a.md', 'draft')

    const flushing = controller.flushAsync()
    controller.schedule('/workspace/a.md', 'newest')
    controller.setSaveHandler(otherOwnerSave)
    finishOldSave()
    await expect(flushing).resolves.toBe(true)
    await vi.advanceTimersByTimeAsync(1500)

    expect(ownerSave.mock.calls).toEqual([
      ['/workspace/a.md', 'old'], ['/workspace/a.md', 'newest'],
    ])
    expect(otherOwnerSave).not.toHaveBeenCalled()
  })

  it('does not revive a discarded draft after an earlier save settles', async () => {
    vi.useFakeTimers()
    let finishOldSave!: () => void
    const save = vi.fn(() => new Promise<void>((resolve) => { finishOldSave = resolve }))
    const controller = new SourceSaveController(save)
    controller.schedule('/workspace/a.md', 'old')
    controller.flush()
    controller.schedule('/workspace/a.md', 'discarded')

    const flushing = controller.flushAsync()
    controller.discard()
    finishOldSave()

    await expect(flushing).resolves.toBe(false)
    expect(save).toHaveBeenCalledTimes(1)
    expect(controller.hasPendingSave()).toBe(false)
  })

  it('makes concurrent explicit saves wait for the latest draft without writing it twice', async () => {
    vi.useFakeTimers()
    let finishOldSave!: () => void
    let finishLatestSave!: () => void
    const save = vi.fn()
      .mockReturnValueOnce(new Promise<void>((resolve) => { finishOldSave = resolve }))
      .mockReturnValueOnce(new Promise<void>((resolve) => { finishLatestSave = resolve }))
    const controller = new SourceSaveController(save)
    controller.schedule('/workspace/a.md', 'old')
    controller.flush()
    controller.schedule('/workspace/a.md', 'latest')

    let settled = 0
    const first = controller.flushAsync().then(() => { settled++ })
    const second = controller.flushAsync().then(() => { settled++ })
    finishOldSave()
    await vi.advanceTimersByTimeAsync(0)
    expect(save).toHaveBeenCalledTimes(2)
    expect(settled).toBe(0)

    finishLatestSave()
    await Promise.all([first, second])
    expect(settled).toBe(2)
    expect(save).toHaveBeenLastCalledWith('/workspace/a.md', 'latest')
  })
})

it('serializes automatic flushes and preserves each captured document owner', async () => {
  let finish!: () => void
  const first = new Promise<void>((resolve) => { finish = resolve })
  const save = vi.fn().mockReturnValueOnce(first).mockResolvedValue({ success: true })
  const controller = new SourceSaveController(save)
  controller.schedule('/workspace/a.md', 'old')
  controller.flush()
  controller.schedule('/workspace/a.md', 'latest')
  controller.flush()
  controller.schedule('/workspace/b.md', 'other document')
  controller.flush()
  expect(save).toHaveBeenCalledTimes(1)
  finish()
  await controller.flushAsync()
  expect(save.mock.calls).toEqual([
    ['/workspace/a.md', 'old'], ['/workspace/a.md', 'latest'], ['/workspace/b.md', 'other document'],
  ])
})

it('keeps queued edits from an unmounted editor ahead of its replacement', async () => {
  let finish!: () => void
  const oldWrite = new Promise<void>((resolve) => { finish = resolve })
  const writes: string[] = []
  const previous = new SourceSaveController((_path, content) => {
    writes.push(content)
    return content === 'old' ? oldWrite : Promise.resolve()
  })
  const replacement = new SourceSaveController((_path, content) => { writes.push(content) })
  previous.schedule('/workspace/remount.md', 'old')
  previous.flush()
  previous.schedule('/workspace/remount.md', 'queued before unmount')
  previous.flush()
  replacement.schedule('/workspace/remount.md', 'latest after remount')
  replacement.flush()
  expect(writes).toEqual(['old'])
  finish()
  await Promise.all([previous.flushAsync(), replacement.flushAsync()])
  expect(writes).toEqual(['old', 'queued before unmount', 'latest after remount'])
})

it('keeps queued saves marked unsettled so old content echoes cannot replace the draft', async () => {
  let finish!: () => void
  const save = vi.fn().mockReturnValueOnce(new Promise<void>((resolve) => { finish = resolve })).mockResolvedValue(undefined)
  const controller = new SourceSaveController(save)
  controller.schedule('/workspace/echo.md', 'old')
  controller.flush()
  controller.schedule('/workspace/echo.md', 'latest')
  controller.flush()
  expect(controller.hasPendingSave()).toBe(false)
  expect(controller.hasUnsettledSave('/workspace/echo.md')).toBe(true)
  expect(controller.hasUnsettledSave('/workspace/other.md')).toBe(false)
  finish()
  await controller.flushAsync()
  expect(controller.hasUnsettledSave('/workspace/echo.md')).toBe(false)
})
