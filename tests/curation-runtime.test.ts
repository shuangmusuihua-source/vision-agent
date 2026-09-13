import { mkdtemp, readdir, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CurationDrafts, CurationJobs } from '../src/main/curation-jobs'

const mocks = vi.hoisted(() => ({ root: '', query: vi.fn(), options: vi.fn(() => ({})), usage: vi.fn() }))
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: mocks.query }))
vi.mock('../src/main/agent-options', () => ({ buildAgentOptions: mocks.options }))
vi.mock('../src/main/app-identity', () => ({ getAppUserDataDir: () => mocks.root }))
vi.mock('../src/main/persistence/profile-store', () => ({ getActiveProfileUsageIdentity: () => ({ profileId: 'p1' }) }))
vi.mock('../src/main/persistence/model-usage-store', () => ({ recordModelUsage: mocks.usage }))
const { withCurationModel, curationJobs } = await import('../src/main/curation-runtime')

beforeEach(async () => {
  mocks.root = await mkdtemp(join(tmpdir(), 'sumi-curation-runtime-'))
  mocks.options.mockReset().mockReturnValue({}); mocks.query.mockReset(); mocks.usage.mockClear()
})
afterEach(async () => { await rm(mocks.root, { recursive: true, force: true }) })
const request = { owner: 1, requestId: 'test-request', sessionId: 'app-session', workspacePath: '/workspace', source: 'knowledge-curation' as const }

describe('ephemeral curation model', () => {
  it('disables memory, tools, persisted transcripts, and attributes usage', async () => {
    mocks.query.mockImplementation(async function* () { yield { type: 'result', subtype: 'success', result: 'draft' } })
    expect(await withCurationModel(request, llm => llm.chat({ system: 'rules', prompt: 'data' }))).toBe('draft')
    expect(mocks.options).toHaveBeenCalledWith(expect.objectContaining({ memoryMode: 'disabled', settingSources: [], skills: [], allowedTools: [], maxTurns: 1 }))
    expect(mocks.query.mock.calls[0][0].options).toMatchObject({ tools: [], persistSession: false, systemPrompt: 'rules' })
    expect(mocks.usage).toHaveBeenCalledWith(expect.objectContaining({ source: 'knowledge-curation', sessionId: 'app-session' }))
    expect(await readdir(join(mocks.root, '.sumi/curation-runs'))).toEqual([])
  })
  it('cancels only the requesting window and waits for session cancellation', async () => {
    let started!: () => void
    const ready = new Promise<void>(resolve => { started = resolve })
    mocks.query.mockImplementation(async function* ({ options }) {
      const signal: AbortSignal = options.abortController.signal
      started()
      await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }))
      yield { type: 'result', subtype: 'success', result: 'late result' }
    })
    const run = withCurationModel(request, llm => llm.chat({ system: 'rules', prompt: 'data' }))
    const rejected = expect(run).rejects.toThrow()
    await ready
    curationJobs.cancel(2, request.requestId)
    expect(mocks.query.mock.calls[0][0].options.abortController.signal.aborted).toBe(false)
    await curationJobs.cancelScope({ sessionId: 'app-session' })
    await rejected
    expect(await readdir(join(mocks.root, '.sumi/curation-runs'))).toEqual([])
  })
  it('cleans temporary files if model setup fails', async () => {
    mocks.options.mockImplementation(() => { throw new Error('profile unavailable') })
    await expect(withCurationModel(request, async () => 'unused')).rejects.toThrow('profile unavailable')
    expect(await readdir(join(mocks.root, '.sumi/curation-runs'))).toEqual([])
  })
})

it('bounds pending work and enforces draft ownership and expiry', async () => {
  const jobs = new CurationJobs()
  await expect(jobs.run(1, '../escape', {}, async () => 1)).rejects.toThrow('标识无效')
  const drafts = new CurationDrafts<string>()
  const now = vi.spyOn(Date, 'now').mockReturnValue(100)
  const draft = drafts.add(1, { kind: 'skill', title: 'test', files: [] }, 'owned')
  expect(() => drafts.get(2, draft.id)).toThrow('过期')
  expect(drafts.get(1, draft.id).value).toBe('owned')
  const other = drafts.add(2, { kind: 'skill', title: 'other', files: [] }, 'other')
  drafts.discardOwner(2)
  expect(() => drafts.get(2, other.id)).toThrow('过期')
  expect(drafts.get(1, draft.id).value).toBe('owned')
  now.mockReturnValue(100 + 31 * 60_000)
  expect(() => drafts.get(1, draft.id)).toThrow('过期')
  now.mockRestore()
})
