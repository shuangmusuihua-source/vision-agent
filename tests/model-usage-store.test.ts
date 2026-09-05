import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ runs: [] as any[], writes: vi.fn() }))
vi.mock('electron-store', () => ({ default: class {
  get() { return mocks.runs }
  set(_key: string, runs: any[]) { mocks.runs = runs; mocks.writes(runs) }
} }))
vi.mock('../src/main/app-identity', () => ({ getAppUserDataDir: () => '/unused-test' }))
beforeEach(() => { vi.resetModules(); mocks.runs = []; mocks.writes.mockClear() })
it('migrates old inline document paths without changing interactive session IDs', async () => {
  mocks.runs = [{ source: 'inline-rewrite', sessionId: '/Users/example/private.md' }, { source: 'interactive', sessionId: 'app-a' }]
  await import('../src/main/persistence/model-usage-store')
  expect(mocks.runs[0].sessionId).toMatch(/^file:sha256:[a-f0-9]{64}$/)
  expect(mocks.runs[1].sessionId).toBe('app-a')
  expect(JSON.stringify(mocks.writes.mock.calls)).not.toContain('/Users/example')
})
it('stores stable opaque document identifiers across rewrites', async () => {
  const { recordModelUsage } = await import('../src/main/persistence/model-usage-store')
  const options = { result: { uuid: 'result-1' } as never, profile: { id: 'a', name: 'A', model: 'm' },
    source: 'inline-rewrite' as const, sessionId: '/Users/example/private.md', sessionTitle: 'document', workspaceName: 'workspace' }
  recordModelUsage(options)
  recordModelUsage({ ...options, result: { uuid: 'result-2' } as never })
  expect(mocks.runs).toHaveLength(2)
  expect(mocks.runs[0].sessionId).toBe(mocks.runs[1].sessionId)
  expect(JSON.stringify(mocks.runs)).not.toContain('/Users/example')
})
