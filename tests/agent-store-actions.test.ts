import { beforeEach, describe, expect, it } from 'vitest'
import { useAgentStore } from '../src/renderer/store/agent-store-impl'
import { emptySlot } from '../src/renderer/store/agent-store'
import type { ConversationMessage } from '../src/shared/types'

function resetStore(): void {
  useAgentStore.setState({
    context: 'editor',
    slots: { editor: emptySlot(), ask: emptySlot() },
    isResumingSession: false,
    sessionList: [],
    sessionSlots: {},
    sessionAccessOrder: [],
    activeWorkspacePath: null,
    activeSessionId: { editor: null, ask: null },
    sessionOutputs: null,
    sessionOutputsLoading: false,
    sessionLoadError: null,
  })
}

function artifactMessage(id: string): ConversationMessage {
  return {
    kind: 'artifact',
    id,
    role: 'assistant',
    artifact: {
      fileName: 'result.html',
      fileType: 'html',
      content: '<main>result</main>',
    },
    createdAt: 1,
  }
}

describe('agent store intent actions', () => {
  beforeEach(resetStore)

  it('mirrors linked-file changes to the live slot and active session cache', () => {
    const slot = { ...emptySlot(), currentSessionId: 'session-a' }
    useAgentStore.setState({
      activeSessionId: { editor: 'session-a', ask: null },
      slots: { editor: slot, ask: emptySlot() },
      sessionSlots: { 'session-a': slot },
      sessionAccessOrder: ['session-a'],
    })

    useAgentStore.getState().setLinkedFile('editor', '/workspace/note.md')

    const state = useAgentStore.getState()
    expect(state.slots.editor.linkedFile).toBe('/workspace/note.md')
    expect(state.sessionSlots['session-a'].linkedFile).toBe('/workspace/note.md')
  })

  it('keeps composer text and attachments isolated per session', () => {
    const sessionA = {
      ...emptySlot(),
      currentSessionId: 'session-a',
      composerDraft: {
        text: 'draft A',
        attachments: [{ name: 'a.md', path: '/workspace/a.md', type: 'text' as const }],
      },
    }
    const sessionB = {
      ...emptySlot(),
      currentSessionId: 'session-b',
      composerDraft: { text: 'draft B', attachments: [] },
    }
    useAgentStore.setState({
      activeSessionId: { editor: 'session-a', ask: null },
      slots: { editor: sessionA, ask: emptySlot() },
      sessionSlots: { 'session-a': sessionA, 'session-b': sessionB },
      sessionAccessOrder: ['session-a', 'session-b'],
    })

    useAgentStore.getState().updateComposerDraft('editor', { text: 'updated A' }, 'session-a')
    useAgentStore.getState().switchToSession('session-b', 'editor')

    expect(useAgentStore.getState().slots.editor.composerDraft).toEqual({
      text: 'draft B',
      attachments: [],
    })

    useAgentStore.getState().updateComposerDraft('editor', {
      attachments: [{ name: 'b.pdf', path: '/workspace/b.pdf', type: 'pdf' }],
    }, 'session-b')
    useAgentStore.getState().switchToSession('session-a', 'editor')

    const state = useAgentStore.getState()
    expect(state.slots.editor.composerDraft).toEqual({
      text: 'updated A',
      attachments: [{ name: 'a.md', path: '/workspace/a.md', type: 'text' }],
    })
    expect(state.sessionSlots['session-b'].composerDraft).toEqual({
      text: 'draft B',
      attachments: [{ name: 'b.pdf', path: '/workspace/b.pdf', type: 'pdf' }],
    })
  })

  it('records a saved artifact in both representations of the active session', () => {
    const slot = {
      ...emptySlot(),
      currentSessionId: 'session-a',
      messages: [artifactMessage('artifact-a')],
    }
    useAgentStore.setState({
      activeSessionId: { editor: 'session-a', ask: null },
      slots: { editor: slot, ask: emptySlot() },
      sessionSlots: { 'session-a': slot },
      sessionAccessOrder: ['session-a'],
    })

    useAgentStore.getState().markArtifactSaved('editor', 'artifact-a', '/workspace/result.html')

    for (const message of [
      useAgentStore.getState().slots.editor.messages[0],
      useAgentStore.getState().sessionSlots['session-a'].messages[0],
    ]) {
      expect(message.kind).toBe('artifact')
      if (message.kind === 'artifact') {
        expect(message.artifact.filePath).toBe('/workspace/result.html')
        expect(message.artifact.content).toBeUndefined()
      }
    }
  })

  it('removes a deleted session from every cached store index', () => {
    const slot = { ...emptySlot(), currentSessionId: 'session-a' }
    useAgentStore.setState({
      sessionList: [{
        id: 'session-a',
        title: 'Session A',
        workspacePath: '/workspace',
        createdAt: 1,
        lastModified: 1,
        messageCount: 0,
      }],
      sessionSlots: { 'session-a': slot },
      sessionAccessOrder: ['session-a'],
    })

    useAgentStore.getState().removeSessionState('session-a')

    const state = useAgentStore.getState()
    expect(state.sessionList).toEqual([])
    expect(state.sessionSlots['session-a']).toBeUndefined()
    expect(state.sessionAccessOrder).toEqual([])
  })

  it('clears the Ask session through one store action', () => {
    useAgentStore.setState({
      context: 'ask',
      activeSessionId: { editor: null, ask: 'ask-a' },
      slots: {
        editor: emptySlot(),
        ask: {
          ...emptySlot(),
          currentSessionId: 'ask-a',
          messages: [{ kind: 'user', id: 'user-a', role: 'user', textContent: 'hello', createdAt: 1 }],
        },
      },
    })

    useAgentStore.getState().clearContextSession('ask')

    const state = useAgentStore.getState()
    expect(state.activeSessionId.ask).toBeNull()
    expect(state.slots.ask).toEqual(emptySlot())
  })

  it('starts a message in a new context session and mirrors the optimistic user message', () => {
    const sessionId = useAgentStore.getState().beginMessage('ask', 'visible prompt', {
      id: 'skill-a',
      name: 'Skill A',
      icon: 'sparkles',
    })

    const state = useAgentStore.getState()
    expect(sessionId).toMatch(/^new-ask-/)
    expect(state.activeSessionId.ask).toBe(sessionId)
    expect(state.activeSessionId.editor).toBeNull()
    expect(state.slots.ask.currentSessionId).toBe(sessionId)
    expect(state.slots.ask.isStreaming).toBe(true)
    expect(state.slots.ask.activeSkillId).toBe('skill-a')
    expect(state.slots.ask.messages[0]).toMatchObject({
      kind: 'user',
      textContent: 'visible prompt',
      skillMeta: { id: 'skill-a', status: 'running' },
    })
    expect(state.sessionSlots[sessionId].messages).toEqual(state.slots.ask.messages)
  })

  it('materializes a temporary session without replacing its app-owned id', () => {
    const tempSlot = {
      ...emptySlot(),
      currentSessionId: 'temp-a',
      isStreaming: true,
      composerDraft: { text: 'follow up', attachments: [] },
      messages: [{ kind: 'user' as const, id: 'user-a', role: 'user' as const, textContent: 'hello', createdAt: 1 }],
    }
    useAgentStore.setState({
      activeSessionId: { editor: 'temp-a', ask: null },
      slots: { editor: tempSlot, ask: emptySlot() },
      sessionSlots: { 'temp-a': tempSlot },
      sessionAccessOrder: ['temp-a'],
      sessionList: [{
        id: 'temp-a',
        title: 'Research',
        workspacePath: '/workspace',
        createdAt: 1,
        lastModified: 1,
        messageCount: 1,
      }],
    })

    const result = useAgentStore.getState().materializeSession({
      context: 'editor',
      sessionId: 'temp-a',
      clientSessionKey: 'temp-a',
      sdkSessionId: 'sdk-a',
      workspacePath: '/workspace',
    })

    const state = useAgentStore.getState()
    expect(result).toEqual({ clientSessionKey: 'temp-a', sdkSessionId: 'sdk-a', sessionTitle: 'Research' })
    expect(state.activeSessionId.editor).toBe('temp-a')
    expect(state.slots.editor.currentSessionId).toBe('temp-a')
    expect(state.slots.editor.sdkSessionId).toBe('sdk-a')
    expect(state.slots.editor.composerDraft.text).toBe('follow up')
    expect(state.sessionSlots['temp-a'].sdkSessionId).toBe('sdk-a')
    expect(state.sessionSlots['temp-a'].composerDraft.text).toBe('follow up')
    expect(state.sessionList[0]).toMatchObject({ id: 'temp-a', sdkSessionId: 'sdk-a', title: 'Research' })
  })

  it('preserves the previous slot when starting a fresh session', () => {
    const current = {
      ...emptySlot(),
      currentSessionId: 'session-a',
      workspacePath: '/workspace',
      messages: [{ kind: 'user' as const, id: 'user-a', role: 'user' as const, textContent: 'hello', createdAt: 1 }],
    }
    useAgentStore.setState({
      activeSessionId: { editor: 'session-a', ask: null },
      slots: { editor: current, ask: emptySlot() },
    })

    useAgentStore.getState().startNewSession('editor')

    const state = useAgentStore.getState()
    expect(state.activeSessionId.editor).toBeNull()
    expect(state.sessionSlots['session-a'].messages).toEqual(current.messages)
    expect(state.slots.editor.messages).toEqual([])
    expect(state.slots.editor.workspacePath).toBe('/workspace')
  })
})
