import { EventEmitter } from 'node:events'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ execFile: vi.fn() }))
vi.mock('child_process', () => ({ execFile: mocks.execFile }))
vi.mock('../src/main/markitdown-runtime', () => ({ getMarkitdownRuntimeManager: () => ({ getStatus: async () => ({ state: 'ready', pythonPath: '/unused/python' }) }) }))
vi.mock('../src/main/attachment-path-authorization', () => ({ consumeAttachmentPathGrant: vi.fn() }))
import { convertAttachmentsToMarkdown } from '../src/main/attachment-conversion'
it('waits for the cancelled parser to exit and does not write converted output', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sumi-conversion-cancel-'))
  const child = new EventEmitter()
  let entered!: () => void
  const ready = new Promise<void>((resolve) => { entered = resolve })
  mocks.execFile.mockImplementation((_file, _args, options, callback) => {
    options.signal.addEventListener('abort', () => callback(new Error('aborted'), '', ''))
    entered()
    return child
  })
  const controller = new AbortController()
  let finished = false
  const conversion = convertAttachmentsToMarkdown(dir, 'session', [{ sourcePath: '/input.pdf' }], controller.signal)
  const result = conversion.catch((error) => { finished = true; return error })
  try {
    await ready
    controller.abort()
    await Promise.resolve()
    expect(finished).toBe(false)
    child.emit('close', null, 'SIGTERM')
    expect(await result).toBeInstanceOf(Error)
    expect(await readdir(join(dir, '.sumi', 'attachments', 'session'))).toEqual([])
  } finally {
    child.emit('close', null, 'SIGTERM')
    await result
    await rm(dir, { recursive: true, force: true })
  }
})
