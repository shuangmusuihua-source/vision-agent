import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import type { ModelUsageRun } from '../src/main/model-usage-analytics'

const mocks = vi.hoisted(() => ({
  root: '',
  beforeWrite: vi.fn<(path: string, content: string) => Promise<void>>(),
}))
vi.mock('../src/main/app-identity', () => ({ getAppUserDataDir: () => mocks.root }))
vi.mock('../src/main/atomic-write', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/main/atomic-write')>()
  return { ...actual, atomicWriteTextFile: async (path: string, content: string) => {
    await mocks.beforeWrite(path, content)
    return actual.atomicWriteTextFile(path, content)
  } }
})

let usage: typeof import('../src/main/persistence/model-usage-store')
const stores: Array<{ flush: () => Promise<void> }> = []

function run(id: string, patch: Partial<ModelUsageRun> = {}): ModelUsageRun {
  return { id, recordedAt: 1, profileId: 'a', profileName: 'A', configuredModel: 'm', source: 'interactive',
    sessionId: 'app-a', sessionTitle: 'Session', workspaceName: 'Workspace', skillIds: [], durationMs: 1,
    numTurns: 1, totalCostUSD: 0.1, models: [], ...patch }
}

async function persisted() {
  return JSON.parse(await readFile(join(mocks.root, 'model-usage.json'), 'utf8')) as { runs: ModelUsageRun[] }
}

beforeEach(async () => {
  vi.resetModules()
  mocks.root = await mkdtemp(join(tmpdir(), 'sumi-model-usage-'))
  mocks.beforeWrite.mockReset()
  usage = await import('../src/main/persistence/model-usage-store')
})

afterEach(async () => {
  mocks.beforeWrite.mockReset()
  await Promise.allSettled([usage.flushModelUsage(), ...stores.splice(0).map(store => store.flush())])
  await rm(mocks.root, { recursive: true, force: true })
  vi.restoreAllMocks()
})

it('migrates old inline document paths without changing interactive session IDs', async () => {
  await writeFile(join(mocks.root, 'model-usage.json'), JSON.stringify({ runs: [
    run('inline', { source: 'inline-rewrite', sessionId: '/Users/example/private.md' }), run('interactive'),
  ] }))
  await usage.getModelUsageSummaries(['a'])
  const { runs } = await persisted()
  expect(runs[0].sessionId).toMatch(/^file:sha256:[a-f0-9]{64}$/)
  expect(runs[1].sessionId).toBe('app-a')
  expect(JSON.stringify(mocks.beforeWrite.mock.calls)).not.toContain('/Users/example')
})

it('stores stable opaque document identifiers across rewrites', async () => {
  const options = { result: { uuid: 'result-1' } as never, profile: { id: 'a', name: 'A', model: 'm' },
    source: 'inline-rewrite' as const, sessionId: '/Users/example/private.md', sessionTitle: 'document', workspaceName: 'workspace' }
  usage.recordModelUsage(options)
  usage.recordModelUsage({ ...options, result: { uuid: 'result-2' } as never })
  await usage.flushModelUsage()
  const { runs } = await persisted()
  expect(runs).toHaveLength(2)
  expect(runs[0].sessionId).toBe(runs[1].sessionId)
  expect(JSON.stringify(runs)).not.toContain('/Users/example')
  expect(mocks.beforeWrite).toHaveBeenCalledTimes(1)
})

it('batches bursts, retains the latest duplicate, and reloads the bounded ledger', async () => {
  const file = join(mocks.root, 'model-usage.json')
  await writeFile(file, JSON.stringify({ runs: Array.from({ length: 20_000 }, (_, i) => run(`old-${i}`)) }))
  const store = new usage.ModelUsageStore(file)
  stores.push(store)
  store.record(run('new'))
  store.record(run('new', { totalCostUSD: 0.5 }))
  // No serialization or persistence is performed in the caller's stack.
  expect(mocks.beforeWrite).not.toHaveBeenCalled()
  await store.flush()
  const { runs } = await persisted()
  expect(runs).toHaveLength(20_000)
  expect(runs[0].id).toBe('old-1')
  expect(runs.at(-1)).toMatchObject({ id: 'new', totalCostUSD: 0.5 })
  expect(mocks.beforeWrite).toHaveBeenCalledTimes(1)
  const reopened = new usage.ModelUsageStore(file)
  stores.push(reopened)
  expect((await reopened.summaries(['a']))[0].totals.requestCount).toBe(20_000)
  expect(mocks.beforeWrite).toHaveBeenCalledTimes(1)
})

it('flushes records that arrive during an in-flight write before resolving', async () => {
  const store = new usage.ModelUsageStore(join(mocks.root, 'model-usage.json'))
  stores.push(store)
  let release!: () => void
  let started!: () => void
  const began = new Promise<void>(resolve => { started = resolve })
  mocks.beforeWrite.mockImplementationOnce(async () => {
    started()
    await new Promise<void>(resolve => { release = resolve })
  })
  store.record(run('first'))
  const flushing = store.flush()
  await began
  store.record(run('second'))
  store.record(run('first', { totalCostUSD: 0.4 }))
  release()
  await flushing
  expect((await persisted()).runs).toEqual([run('first', { totalCostUSD: 0.4 }), run('second')])
})

it('retains failed writes and retries them together with later records', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const store = new usage.ModelUsageStore(join(mocks.root, 'model-usage.json'))
  stores.push(store)
  mocks.beforeWrite.mockRejectedValueOnce(new Error('disk unavailable'))
  store.record(run('first'))
  await expect(store.flush()).rejects.toThrow('disk unavailable')
  store.record(run('second'))
  await store.flush()
  expect((await persisted()).runs.map(item => item.id)).toEqual(['first', 'second'])
})

it('preserves an unreadable ledger instead of replacing history with new records', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const file = join(mocks.root, 'model-usage.json')
  await writeFile(file, 'invalid history')
  const store = new usage.ModelUsageStore(file)
  stores.push(store)
  store.record(run('new'))
  await expect(store.flush()).rejects.toThrow()
  expect(mocks.beforeWrite).not.toHaveBeenCalled()
  await expect(readFile(file, 'utf8')).resolves.toBe('invalid history')
})
