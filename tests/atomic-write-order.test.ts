import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const io = vi.hoisted(() => ({ beforeWrite: null as null | ((content: unknown) => Promise<void>) }))
vi.mock('fs/promises', async () => {
  const fs = await vi.importActual<typeof import('fs/promises')>('fs/promises')
  return { ...fs, open: async (...args: Parameters<typeof fs.open>) => {
    const handle = await fs.open(...args)
    const write = handle.writeFile.bind(handle)
    handle.writeFile = async (...input: Parameters<typeof write>) => {
      await io.beforeWrite?.(input[0])
      return write(...input)
    }
    return handle
  } }
})
import { atomicWriteTextFile } from '../src/main/atomic-write'
afterEach(() => { io.beforeWrite = null })
it('orders replacements of one file while allowing unrelated files to progress', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sumi-write-order-'))
  let release!: () => void, entered!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  const ready = new Promise<void>((resolve) => { entered = resolve })
  io.beforeWrite = async (content) => { if (content === 'old') { entered(); await gate } }
  const target = join(dir, 'draft.md')
  const first = atomicWriteTextFile(target, 'old')
  await ready
  const second = atomicWriteTextFile(join(dir, '.', 'draft.md'), 'latest')
  try {
    await atomicWriteTextFile(join(dir, 'other.md'), 'independent')
    release()
    await Promise.all([first, second])
    expect(await readFile(target, 'utf8')).toBe('latest')
  } finally {
    release()
    await Promise.allSettled([first, second])
    await rm(dir, { recursive: true, force: true })
  }
})
