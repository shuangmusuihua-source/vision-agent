import { afterEach, expect, it, vi } from 'vitest'
import { useAgentStore } from '../src/renderer/store/agent-store-impl'
import { emptySlot } from '../src/renderer/store/agent-store'

afterEach(() => { vi.unstubAllGlobals() })
it.each([
  ['initial', 'success'], ['initial', 'error'], ['more', 'success'], ['more', 'error'],
])('ignores %s history %s after deletion', async (phase, outcome) => {
  let resolve!: (value: unknown) => void, reject!: (error: Error) => void
  const response = new Promise((res, rej) => { resolve = res; reject = rej })
  vi.stubGlobal('window', { api: { agent: { loadSessionMessagesPaginated: () => response } } })
  const slot = { ...emptySlot(), currentSessionId: 'a', sdkSessionId: 'sdk-a', workspacePath: '/workspace',
    _needsSdkLoad: true, _sessionPageCursor: 'opaque' as never }
  useAgentStore.setState({ slots: { editor: slot, ask: emptySlot() }, sessionSlots: { a: slot },
    sessionAccessOrder: ['a'], sessionList: [], activeSessionId: { editor: 'a', ask: null }, sessionLoadError: null })
  const loading = phase === 'initial'
    ? useAgentStore.getState().loadInitialSessionMessages('a')
    : useAgentStore.getState().loadMoreSessionMessages('a')
  useAgentStore.getState().removeSessionState('a')
  useAgentStore.getState().switchToSession('')
  if (outcome === 'success') resolve({ messages: [], cursor: null, hasMore: false })
  else reject(new Error('late error'))
  await loading
  expect(useAgentStore.getState().sessionSlots.a).toBeUndefined()
  expect(useAgentStore.getState().sessionAccessOrder).not.toContain('a')
  expect(useAgentStore.getState().sessionLoadError).toBeNull()
})
