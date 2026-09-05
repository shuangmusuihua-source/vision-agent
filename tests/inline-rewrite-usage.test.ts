import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ profile: 'A', query: vi.fn(), startup: vi.fn(), record: vi.fn() }))
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: mocks.query, startup: mocks.startup }))
vi.mock('../src/main/agent-options', () => ({ buildAgentOptions: () => ({ model: mocks.profile }) }))
vi.mock('../src/main/persistence/profile-store', () => ({ getActiveProfileUsageIdentity: () => ({ id: mocks.profile, name: mocks.profile, model: mocks.profile }) }))
vi.mock('../src/main/persistence/model-usage-store', () => ({ recordModelUsage: mocks.record }))
import { inlineRewriteRunner } from '../src/main/inline-rewrite-runner'
beforeEach(() => { mocks.profile = 'A'; vi.clearAllMocks() })
it.each([false, true])('keeps execution profile in usage attribution (prewarmed=%s)', async (prewarm) => {
  let entered!: () => void, release!: () => void
  const ready = new Promise<void>((resolve) => { entered = resolve })
  const gate = new Promise<void>((resolve) => { release = resolve })
  const messages = async function* () { entered(); await gate; yield { type: 'result', subtype: 'success', result: 'done', uuid: 'result' } }
  mocks.query.mockImplementation(messages)
  mocks.startup.mockImplementation(async () => ({ query: messages, close: vi.fn() }))
  const request = { requestId: `rewrite-${prewarm}`, filePath: '/private/document.md', instruction: 'rewrite', selectedMarkdown: 'example', beforeContext: '', afterContext: '' }
  if (prewarm) {
    inlineRewriteRunner.prepare(request)
    await vi.waitFor(() => expect(mocks.startup).toHaveBeenCalledOnce())
    mocks.profile = 'B'
  }
  const rewriting = inlineRewriteRunner.rewrite(request)
  await ready
  mocks.profile = 'C'
  release()
  await rewriting
  expect(mocks.record.mock.calls[0][0].profile.id).toBe('A')
})
