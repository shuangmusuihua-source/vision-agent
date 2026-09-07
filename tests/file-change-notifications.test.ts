import { afterEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FileChangeBatch } from '../src/shared/ipc-types'

const mocks = vi.hoisted(() => ({ watch: vi.fn(), send: vi.fn() }))
vi.mock('chokidar', () => ({ default: { watch: mocks.watch } }))
vi.mock('../src/main/ipc-sender', () => ({
  getMainWindow: () => ({ isDestroyed: () => false, webContents: { send: mocks.send } }),
}))

import { FileIndexService } from '../src/main/file-index-service'

const cleanups: Array<() => Promise<unknown>> = []

async function setup() {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const root = await mkdtemp(join(tmpdir(), 'sumi-notifications-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  await writeFile(join(root, 'original.md'), '# Original')
  const watcher = Object.assign(new EventEmitter(), { close: vi.fn(async () => {}) })
  mocks.watch.mockReturnValue(watcher)
  const service = new FileIndexService()
  cleanups.push(() => service.destroy())
  await service.init([root])
  return { root, service, watcher }
}

function batches(): FileChangeBatch[] {
  return mocks.send.mock.calls.map(([channel, batch]) => {
    expect(channel).toBe('graph:filesChanged')
    return batch
  })
}

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('file change notification batches', () => {
  it('sends each path once across bursts without requiring a graph acknowledgement', async () => {
    const { root, service, watcher } = await setup()
    for (let burst = 0; burst < 10; burst++) {
      for (let i = 0; i < 1_000; i++) watcher.emit('unlink', join(root, `${burst}-${i}.md`))
      expect(mocks.send).toHaveBeenCalledTimes(burst)
      await vi.advanceTimersByTimeAsync(50)
    }
    const sent = batches()
    expect(sent).toHaveLength(10)
    expect(sent.reduce((total, batch) => total + batch.files.length, 0)).toBe(10_000)
    expect(sent.at(-1)).toMatchObject({ count: 10_000, version: 10_000 })
    expect(service.getFileChangeSnapshot().files).toHaveLength(10_000)
  })

  it('deduplicates a batch but delivers later changes to the same path again', async () => {
    const { root, watcher } = await setup()
    const file = join(root, 'file.md')
    watcher.emit('unlink', file)
    watcher.emit('unlink', file)
    await vi.advanceTimersByTimeAsync(50)
    watcher.emit('unlink', file)
    await vi.advanceTimersByTimeAsync(50)
    expect(batches()).toEqual([
      { files: [file], renames: [], count: 1, version: 2 },
      { files: [file], renames: [], count: 1, version: 3 },
    ])
  })

  it('keeps pending file refreshes when a graph acknowledges changes before delivery', async () => {
    const { root, service, watcher } = await setup()
    const first = join(root, 'first.md')
    const second = join(root, 'second.md')
    watcher.emit('unlink', first)
    const version = service.getChangeVersion()
    watcher.emit('unlink', second)
    expect(service.acknowledgeChanges(version).files).toEqual([second])
    await vi.advanceTimersByTimeAsync(50)
    expect(batches()).toEqual([{ files: [first, second], renames: [], count: 1, version: 2 }])
  })

  it('delivers a rename once even when the deletion and addition span separate batches', async () => {
    const { root, service, watcher } = await setup()
    const from = join(root, 'original.md')
    const to = join(root, 'renamed.md')
    await rename(from, to)
    watcher.emit('unlink', from)
    await vi.advanceTimersByTimeAsync(50)
    watcher.emit('add', to)
    await vi.waitFor(() => expect(service.getChangeVersion()).toBe(2), { interval: 5 })
    await vi.advanceTimersByTimeAsync(50)
    watcher.emit('unlink', join(root, 'unrelated.md'))
    await vi.advanceTimersByTimeAsync(50)
    expect(batches().flatMap((batch) => batch.renames)).toEqual([{ from, to }])
    expect(service.getFileChangeSnapshot().renames).toEqual([{ from, to }])
  })

  it('cancels queued notifications and clears retained paths on destruction', async () => {
    const { root, service, watcher } = await setup()
    watcher.emit('unlink', join(root, 'file.md'))
    await service.destroy()
    await vi.advanceTimersByTimeAsync(100)
    expect(mocks.send).not.toHaveBeenCalled()
    expect(service.getFileChangeSnapshot()).toEqual({ count: 0, version: 0, files: [], renames: [] })
  })
})
