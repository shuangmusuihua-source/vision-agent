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
})
