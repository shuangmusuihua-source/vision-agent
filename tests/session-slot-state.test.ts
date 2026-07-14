import { describe, expect, it } from 'vitest'
import type { AgentStore, ContextSlot } from '../src/renderer/store/agent-store'
import { emptySlot } from '../src/renderer/store/agent-store'
import { useAgentStore } from '../src/renderer/store/agent-store-impl'
import {
  buildSessionSwitchPatch,
  cacheSessionSlot,
  findAskUserTarget,
  patchSessionSlot,
  resolveClientSessionId,
  selectAskUserRequest,
  selectIsResumingSession,
} from '../src/renderer/store/session-slot-state'

function slot(sessionId: string, patch: Partial<ContextSlot> = {}): ContextSlot {
  return { ...emptySlot(), currentSessionId: sessionId, ...patch }
}

function state(patch: Partial<AgentStore> = {}): AgentStore {
  const base = useAgentStore.getState()
  return {
    ...base,
    slots: { editor: emptySlot(), ask: emptySlot() },
    sessionSlots: {},
    sessionAccessOrder: [],
    activeSessionId: { editor: null, ask: null },
    sessionList: [],
    ...patch,
  }
}

describe('session-slot state module', () => {
  it('resolves an SDK session ID to its app-owned session ID', () => {
    const current = state({
      sessionSlots: {
        'app-session': slot('app-session', { sdkSessionId: 'sdk-session' }),
      },
    })

    expect(resolveClientSessionId(current, 'sdk-session')).toBe('app-session')
  })

  it('mirrors active patches while keeping background patches isolated', () => {
    const current = state({
      activeSessionId: { editor: 'active', ask: null },
      slots: { editor: slot('active'), ask: emptySlot() },
      sessionSlots: {
        active: slot('active'),
        background: slot('background'),
      },
    })

    const activePatch = patchSessionSlot(current, 'editor', { linkedFile: '/active.md' }, 'active')
    expect(activePatch.slots?.editor.linkedFile).toBe('/active.md')
    expect(activePatch.sessionSlots?.active.linkedFile).toBe('/active.md')

    const backgroundPatch = patchSessionSlot(current, 'editor', { linkedFile: '/background.md' }, 'background')
    expect(backgroundPatch.slots).toBeUndefined()
    expect(backgroundPatch.sessionSlots?.background.linkedFile).toBe('/background.md')
  })

  it('enforces the slot limit without evicting a live session', () => {
    const sessionSlots: Record<string, ContextSlot> = {}
    const sessionAccessOrder: string[] = []
    for (let index = 0; index < 30; index++) {
      const id = `session-${index}`
      sessionSlots[id] = slot(id)
      sessionAccessOrder.push(id)
    }
    const current = state({
      activeSessionId: { editor: 'session-0', ask: null },
      slots: { editor: slot('session-0'), ask: emptySlot() },
      sessionSlots,
      sessionAccessOrder,
    })

    const next = cacheSessionSlot(current, 'session-30', slot('session-30'))

    expect(next.sessionAccessOrder).toHaveLength(30)
    expect(next.sessionSlots['session-0']).toBeDefined()
    expect(next.sessionSlots['session-1']).toBeUndefined()
    expect(next.sessionSlots['session-30']).toBeDefined()
  })

  it('switches sessions through one interface and keeps live/cache state aligned', () => {
    const current = state({
      activeWorkspacePath: '/workspace',
      activeSessionId: { editor: 'first', ask: null },
      slots: {
        editor: slot('first', { messages: [{
          kind: 'user', id: 'message-1', role: 'user', textContent: 'hello', createdAt: 1,
        }] }),
        ask: emptySlot(),
      },
      sessionSlots: { first: slot('first') },
      sessionAccessOrder: ['first'],
      sessionList: [{ id: 'second', sdkSessionId: 'sdk-second', workspacePath: '/workspace' }],
    })

    const patch = buildSessionSwitchPatch(current, 'editor', 'second')

    expect(patch.activeSessionId?.editor).toBe('second')
    expect(patch.sessionSlots?.first.messages).toHaveLength(1)
    expect(patch.sessionSlots?.second).toBe(patch.slots?.editor)
    expect(patch.slots?.editor.sdkSessionId).toBe('sdk-second')
    expect(patch.slots?.editor._needsSdkLoad).toBe(true)
  })

  it('selects and locates AskUser requests without exposing cache fallback to callers', () => {
    const request = {
      id: 'ask-1',
      questions: [{ question: 'Continue?', options: [], multiSelect: false }],
      context: 'editor' as const,
      sessionId: 'session-a',
    }
    const current = state({
      slots: { editor: slot('session-a'), ask: emptySlot() },
      sessionSlots: {
        'session-a': slot('session-a', { askUserRequest: request }),
      },
    })

    expect(selectAskUserRequest(current, 'editor')).toBe(request)
    expect(findAskUserTarget(current, 'ask-1', 'ask')).toEqual({
      context: 'editor',
      sessionId: 'session-a',
    })
  })

  it('derives resume state from the owning context slot only', () => {
    const current = state({
      slots: {
        editor: slot('editor-session', { _isLoadingMoreMessages: true }),
        ask: slot('ask-session'),
      },
    })

    expect(selectIsResumingSession(current, 'editor')).toBe(true)
    expect(selectIsResumingSession(current, 'ask')).toBe(false)

    current.slots.editor.messages = [{
      kind: 'user', id: 'existing', role: 'user', textContent: 'cached', createdAt: 1,
    }]
    expect(selectIsResumingSession(current, 'editor')).toBe(false)
  })
})
