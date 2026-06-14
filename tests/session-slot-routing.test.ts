import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAgentStore } from '../src/renderer/store/agent-store-impl'
import { emptySlot } from '../src/renderer/store/agent-store'
import { sessionListReducer } from '../src/renderer/store/session-protocol'
import type { AgentIPCMessage, AskUserRequestIPC, ConversationMessage, PermissionRequestIPC, SkillOutputState } from '../src/shared/types'

function resetStore() {
  useAgentStore.setState({
    context: 'editor',
    slots: { editor: emptySlot(), ask: emptySlot() },
    isResumingSession: false,
    sessionList: [],
    sessionSlots: {},
    sessionAccessOrder: [],
    activeWorkspacePath: null,
    workspaceDigest: null,
    workspaceDigestLoading: false,
    activeSessionId: { editor: null, ask: null },
    sessionOutputs: null,
    sessionOutputsLoading: false,
  })
}

function textMessage(id: string, text: string): ConversationMessage {
  return {
    kind: 'text',
    id,
    role: 'assistant',
    phase: 'complete',
    textContent: text,
    content: [],
    toolCalls: [],
    createdAt: 1,
  }
}

function permission(id: string, sessionId: string): PermissionRequestIPC {
  return {
    id,
    toolName: 'Write',
    input: { file_path: `/tmp/${id}.md` },
    context: 'editor',
    sessionId,
  }
}

function askUser(id: string, sessionId: string): AskUserRequestIPC {
  return {
    id,
    questions: [{ question: 'Pick one', options: [], multiSelect: false }],
    question: 'Pick one',
    options: [],
    multiSelect: false,
    context: 'editor',
    sessionId,
  }
}

describe('session-scoped store routing', () => {
  beforeEach(() => {
    resetStore()
  })

  it('clears a background permission request without touching the active editor slot', () => {
    const active = { ...emptySlot(), currentSessionId: 'active-session', permissionRequest: permission('active-perm', 'active-session') }
    const background = { ...emptySlot(), currentSessionId: 'background-session', permissionRequest: permission('background-perm', 'background-session') }

    useAgentStore.setState({
      activeSessionId: { editor: 'active-session', ask: null },
      slots: { editor: active, ask: emptySlot() },
      sessionSlots: { 'background-session': background },
      sessionAccessOrder: ['background-session'],
    })

    useAgentStore.getState().handlePermissionResponse('background-perm', 'allow')

    const state = useAgentStore.getState()
    expect(state.slots.editor.permissionRequest?.id).toBe('active-perm')
    expect(state.sessionSlots['background-session'].permissionRequest).toBeNull()
  })

  it('records a background AskUser answer in the matching session slot only', () => {
    const active = { ...emptySlot(), currentSessionId: 'active-session', messages: [textMessage('active-msg', 'active')] }
    const background = { ...emptySlot(), currentSessionId: 'background-session', messages: [textMessage('bg-msg', 'background')], askUserRequest: askUser('ask-bg', 'background-session') }

    useAgentStore.setState({
      activeSessionId: { editor: 'active-session', ask: null },
      slots: { editor: active, ask: emptySlot() },
      sessionSlots: { 'background-session': background },
      sessionAccessOrder: ['background-session'],
    })

    useAgentStore.getState().handleAskUserResponse('ask-bg', { answer: 'Yes' })

    const state = useAgentStore.getState()
    expect(state.slots.editor.messages).toHaveLength(1)
    expect(state.slots.editor.messages[0].id).toBe('active-msg')
    expect(state.sessionSlots['background-session'].askUserRequest).toBeNull()
    const lastMessage = state.sessionSlots['background-session'].messages.at(-1)
    expect(lastMessage?.kind).toBe('user')
    if (lastMessage?.kind !== 'user') throw new Error('Expected a user answer message')
    expect(lastMessage.textContent).toBe('Yes')
  })

  it('times out background AskUser state without adding timeout UI to the active session', () => {
    const active = { ...emptySlot(), currentSessionId: 'active-session', messages: [textMessage('active-msg', 'active')] }
    const background = {
      ...emptySlot(),
      currentSessionId: 'background-session',
      agentState: 'waitingForUserInput' as const,
      askUserRequest: askUser('ask-bg', 'background-session'),
    }

    useAgentStore.setState({
      activeSessionId: { editor: 'active-session', ask: null },
      slots: { editor: active, ask: emptySlot() },
      sessionSlots: { 'background-session': background },
      sessionAccessOrder: ['background-session'],
    })

    useAgentStore.getState().handleAskUserTimeout('ask-bg')

    const state = useAgentStore.getState()
    expect(state.slots.editor.messages).toHaveLength(1)
    expect(state.sessionSlots['background-session'].askUserRequest).toBeNull()
    expect(state.sessionSlots['background-session'].messages.at(-1)?.kind).toBe('status')
    expect(state.sessionSlots['background-session'].agentState).toBe('error')
  })

  it('routes skill output by session id instead of always writing to the visible context slot', () => {
    const active = { ...emptySlot(), currentSessionId: 'active-session' }
    const background = { ...emptySlot(), currentSessionId: 'background-session' }
    const output: SkillOutputState = {
      skillId: 'skill-1',
      content: '<html></html>',
      isStreaming: true,
      language: 'html',
      context: 'editor',
      sessionId: 'background-session',
    }

    useAgentStore.setState({
      activeSessionId: { editor: 'active-session', ask: null },
      slots: { editor: active, ask: emptySlot() },
      sessionSlots: { 'background-session': background },
      sessionAccessOrder: ['background-session'],
    })

    useAgentStore.getState().handleSkillOutput(output)

    const state = useAgentStore.getState()
    expect(state.slots.editor.skillOutput).toBeNull()
    expect(state.sessionSlots['background-session'].skillOutput).toEqual(output)
  })

  it('routes background assistant messages from the cached session when the visible editor slot is empty', async () => {
    const background = {
      ...emptySlot(),
      currentSessionId: 'background-session',
      agentState: 'running' as const,
      isStreaming: true,
      messages: [textMessage('bg-existing', 'background existing')],
    }
    const assistantMsg: AgentIPCMessage & { context: 'editor'; sessionId: string } = {
      type: 'assistant',
      context: 'editor',
      sessionId: 'background-session',
      uuid: 'bg-new',
      message: { content: [{ type: 'text', text: 'background new' }] },
    }

    useAgentStore.setState({
      activeSessionId: { editor: null, ask: null },
      slots: { editor: emptySlot(), ask: emptySlot() },
      sessionSlots: { 'background-session': background },
      sessionAccessOrder: ['background-session'],
    })

    useAgentStore.getState().processIPCMessage(assistantMsg)
    await new Promise((resolve) => setTimeout(resolve, 0))

    const state = useAgentStore.getState()
    expect(state.slots.editor.messages).toHaveLength(0)
    expect(state.sessionSlots['background-session'].messages.map((m) => m.id)).toEqual([
      'bg-existing',
      'bg-new',
    ])
  })

  it('routes background completion state without clearing the visible editor slot', () => {
    const background = {
      ...emptySlot(),
      currentSessionId: 'background-session',
      agentState: 'running' as const,
      isStreaming: true,
      messages: [textMessage('bg-existing', 'background existing')],
    }

    useAgentStore.setState({
      activeSessionId: { editor: null, ask: null },
      slots: { editor: emptySlot(), ask: emptySlot() },
      sessionSlots: { 'background-session': background },
      sessionAccessOrder: ['background-session'],
    })

    useAgentStore.getState().dispatchAgentEvent({ type: 'RESULT_SUCCESS' }, 'editor', 'background-session')

    const state = useAgentStore.getState()
    expect(state.slots.editor.messages).toHaveLength(0)
    expect(state.sessionSlots['background-session'].agentState).toBe('idle')
    expect(state.sessionSlots['background-session'].isStreaming).toBe(false)
    expect(state.sessionSlots['background-session'].messages.map((m) => m.id)).toEqual(['bg-existing'])
  })

  it('keeps background permission requests off the visible empty editor slot', () => {
    const background = { ...emptySlot(), currentSessionId: 'background-session' }

    useAgentStore.setState({
      activeSessionId: { editor: null, ask: null },
      slots: { editor: emptySlot(), ask: emptySlot() },
      sessionSlots: { 'background-session': background },
      sessionAccessOrder: ['background-session'],
    })

    useAgentStore.getState().handlePermissionRequest(permission('background-perm', 'background-session'))

    const state = useAgentStore.getState()
    expect(state.slots.editor.permissionRequest).toBeNull()
    expect(state.sessionSlots['background-session'].permissionRequest?.id).toBe('background-perm')
  })

  it('keeps background AskUser requests off the visible empty editor slot', () => {
    const background = {
      ...emptySlot(),
      currentSessionId: 'background-session',
      agentState: 'running' as const,
      isStreaming: true,
    }

    useAgentStore.setState({
      activeSessionId: { editor: null, ask: null },
      slots: { editor: emptySlot(), ask: emptySlot() },
      sessionSlots: { 'background-session': background },
      sessionAccessOrder: ['background-session'],
    })

    useAgentStore.getState().handleAskUserRequest(askUser('ask-bg', 'background-session'))

    const state = useAgentStore.getState()
    expect(state.slots.editor.askUserRequest).toBeNull()
    expect(state.sessionSlots['background-session'].askUserRequest?.id).toBe('ask-bg')
    expect(state.sessionSlots['background-session'].agentState).toBe('waitingForUserInput')
  })

  it('does not drive the live FSM when replaying historical SDK messages', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const assistantMsg: AgentIPCMessage & { context: 'editor'; sessionId: string } = {
      type: 'assistant',
      context: 'editor',
      sessionId: 'replay-session',
      uuid: 'assistant-1',
      message: { content: [{ type: 'text', text: 'historical answer' }] },
    }
    const resultMsg: AgentIPCMessage & { context: 'editor'; sessionId: string } = {
      type: 'result',
      subtype: 'success',
      context: 'editor',
      sessionId: 'replay-session',
      session_id: 'replay-session',
      usage: { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0 },
      total_cost_usd: 0,
      duration_ms: 0,
    }

    useAgentStore.getState().processIPCMessage(assistantMsg, { isReplay: true })
    useAgentStore.getState().processIPCMessage(resultMsg, { isReplay: true })

    expect(useAgentStore.getState().slots.editor.agentState).toBe('idle')
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('[AgentFSM] Invalid transition'))
    warnSpy.mockRestore()
  })

  it('keeps the single Ask session running while switching editor sessions', () => {
    const ask = {
      ...emptySlot(),
      currentSessionId: 'ask-session',
      agentState: 'running' as const,
      isStreaming: true,
      messages: [textMessage('ask-msg', 'ask')],
    }
    const editorA = {
      ...emptySlot(),
      currentSessionId: 'editor-a',
      agentState: 'running' as const,
      isStreaming: true,
      messages: [textMessage('editor-a-msg', 'editor A')],
    }
    const editorB = {
      ...emptySlot(),
      currentSessionId: 'editor-b',
      messages: [textMessage('editor-b-msg', 'editor B')],
    }

    useAgentStore.setState({
      activeSessionId: { editor: 'editor-a', ask: 'ask-session' },
      slots: { editor: editorA, ask },
      sessionSlots: { 'editor-b': editorB },
      sessionAccessOrder: ['editor-b'],
    })

    useAgentStore.getState().switchToSession('editor-b', 'editor')

    const askMsg: AgentIPCMessage & { context: 'ask'; sessionId: string } = {
      type: 'assistant',
      context: 'ask',
      sessionId: 'ask-session',
      uuid: 'ask-new-msg',
      message: { content: [{ type: 'text', text: 'ask still running' }] },
    }
    const editorBMsg: AgentIPCMessage & { context: 'editor'; sessionId: string } = {
      type: 'assistant',
      context: 'editor',
      sessionId: 'editor-b',
      uuid: 'editor-b-new-msg',
      message: { content: [{ type: 'text', text: 'editor B answer' }] },
    }

    useAgentStore.getState().processIPCMessage(askMsg)
    useAgentStore.getState().processIPCMessage(editorBMsg)

    const state = useAgentStore.getState()
    expect(state.activeSessionId.ask).toBe('ask-session')
    expect(state.slots.ask.agentState).toBe('running')
    expect(state.slots.ask.messages.at(-1)?.id).toBe('ask-new-msg')
    expect(state.activeSessionId.editor).toBe('editor-b')
    expect(state.slots.editor.currentSessionId).toBe('editor-b')
    expect(state.slots.editor.messages.at(-1)?.id).toBe('editor-b-new-msg')
    expect(state.sessionSlots['editor-a'].agentState).toBe('running')
    expect(state.sessionSlots['editor-a'].isStreaming).toBe(true)
  })

  it('routes pre-materialized Ask events by client session key', () => {
    const tempId = 'new-ask-1'
    const editor = { ...emptySlot(), currentSessionId: 'editor-session', messages: [textMessage('editor-msg', 'editor')] }
    const ask = { ...emptySlot(), currentSessionId: tempId }
    const assistantMsg: AgentIPCMessage & { context: 'ask'; clientSessionKey: string } = {
      type: 'assistant',
      context: 'ask',
      clientSessionKey: tempId,
      uuid: 'assistant-temp',
      message: { content: [{ type: 'text', text: 'temp answer' }] },
    }

    useAgentStore.setState({
      activeSessionId: { editor: 'editor-session', ask: tempId },
      slots: { editor, ask },
      sessionSlots: { [tempId]: ask },
      sessionAccessOrder: [tempId],
    })

    useAgentStore.getState().processIPCMessage(assistantMsg)

    const state = useAgentStore.getState()
    expect(state.slots.editor.messages[0].id).toBe('editor-msg')
    expect(state.slots.ask.messages.at(-1)?.id).toBe('assistant-temp')
    expect(state.sessionSlots[tempId].messages.at(-1)?.id).toBe('assistant-temp')
  })

  it('materializes a missing temp session by attaching SDK metadata without renaming the app session', () => {
    const next = sessionListReducer([], {
      type: 'MATERIALIZE',
      tempId: 'new-ask-1',
      realId: 'real-ask-1',
      context: 'ask',
      workspacePath: '/app/ask',
      title: 'Ask run',
    })

    expect(next).toEqual([
      expect.objectContaining({
        id: 'new-ask-1',
        sdkSessionId: 'real-ask-1',
        context: 'ask',
        workspacePath: '/app/ask',
        title: 'Ask run',
      }),
    ])
  })

  it('keeps an editor session keyed by client id after SDK materialization', async () => {
    const clientId = 'new-editor-a'
    const sdkId = 'sdk-editor-a'
    const userMsg: ConversationMessage = {
      kind: 'user',
      id: 'user-a',
      role: 'user',
      textContent: 'question A',
      createdAt: 1,
    }

    useAgentStore.setState({
      activeSessionId: { editor: clientId, ask: null },
      slots: {
        editor: {
          ...emptySlot(),
          currentSessionId: clientId,
          agentState: 'thinking',
          isStreaming: true,
          messages: [userMsg],
        },
        ask: emptySlot(),
      },
      sessionSlots: {
        [clientId]: {
          ...emptySlot(),
          currentSessionId: clientId,
          agentState: 'thinking',
          isStreaming: true,
          messages: [userMsg],
        },
      },
      sessionAccessOrder: [clientId],
      sessionList: [{
        id: clientId,
        title: 'A',
        workspacePath: '/workspace',
        context: 'editor',
        createdAt: 1,
        lastModified: 1,
        messageCount: 0,
      }],
    })

    useAgentStore.getState().dispatchSessionList({
      type: 'MATERIALIZE',
      tempId: clientId,
      realId: sdkId,
      context: 'editor',
      workspacePath: '/workspace',
      title: 'A',
    })
    useAgentStore.setState((state) => ({
      sessionSlots: {
        ...state.sessionSlots,
        [clientId]: {
          ...state.sessionSlots[clientId],
          sdkSessionId: sdkId,
        },
      },
      slots: {
        ...state.slots,
        editor: {
          ...state.slots.editor,
          sdkSessionId: sdkId,
        },
      },
    }))

    useAgentStore.getState().switchToSession('editor-b', 'editor')
    useAgentStore.getState().processIPCMessage({
      type: 'assistant',
      context: 'editor',
      sessionId: clientId,
      clientSessionKey: clientId,
      sdkSessionId: sdkId,
      uuid: 'assistant-a',
      message: { content: [{ type: 'text', text: 'answer A' }] },
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    const state = useAgentStore.getState()
    expect(state.sessionList.find(s => s.id === clientId)?.sdkSessionId).toBe(sdkId)
    expect(state.sessionSlots[clientId].messages.map((m) => m.id)).toEqual(['user-a', 'assistant-a'])
    expect(state.sessionSlots[clientId].currentSessionId).toBe(clientId)
    expect(state.sessionSlots[clientId].sdkSessionId).toBe(sdkId)
  })

  it('does not wipe optimistic messages when initial SDK history load resolves after a send', async () => {
    let resolveLoad!: (value: {
      messages: AgentIPCMessage[]
      offset: number
      limit: number
      hasMore: boolean
    }) => void
    const loadPromise = new Promise<{
      messages: AgentIPCMessage[]
      offset: number
      limit: number
      hasMore: boolean
    }>((resolve) => { resolveLoad = resolve })
    vi.stubGlobal('window', {
      api: {
        agent: {
          loadSessionMessagesPaginated: vi.fn(() => loadPromise),
        },
      },
    })

    const clientId = 'new-editor-race'
    const sdkId = 'sdk-editor-race'
    const initialSlot = {
      ...emptySlot(),
      currentSessionId: clientId,
      sdkSessionId: sdkId,
      _needsSdkLoad: true,
    }

    useAgentStore.setState({
      activeSessionId: { editor: clientId, ask: null },
      slots: { editor: initialSlot, ask: emptySlot() },
      sessionSlots: { [clientId]: initialSlot },
      sessionAccessOrder: [clientId],
      sessionList: [{ id: clientId, sdkSessionId: sdkId, context: 'editor', workspacePath: '/workspace' }],
    })

    const loading = useAgentStore.getState().loadInitialSessionMessages(clientId, 'editor')
    await new Promise((resolve) => setTimeout(resolve, 0))

    const optimisticUser: ConversationMessage = {
      kind: 'user',
      id: 'user-live',
      role: 'user',
      textContent: 'live question',
      createdAt: 2,
    }
    useAgentStore.setState((state) => ({
      slots: {
        ...state.slots,
        editor: {
          ...state.slots.editor,
          messages: [optimisticUser],
          agentState: 'thinking',
          isStreaming: true,
        },
      },
      sessionSlots: {
        ...state.sessionSlots,
        [clientId]: {
          ...state.sessionSlots[clientId],
          messages: [optimisticUser],
          agentState: 'thinking',
          isStreaming: true,
        },
      },
    }))

    resolveLoad({
      messages: [{
        type: 'assistant',
        uuid: 'assistant-history',
        message: { content: [{ type: 'text', text: 'historical answer' }] },
      }],
      offset: 1,
      limit: 10,
      hasMore: false,
    })
    await loading

    const state = useAgentStore.getState()
    expect(state.slots.editor.messages.map((m) => m.id)).toEqual(['assistant-history', 'user-live'])
    expect(state.sessionSlots[clientId].messages.map((m) => m.id)).toEqual(['assistant-history', 'user-live'])
    expect(state.slots.editor.agentState).toBe('thinking')
    expect(state.slots.editor.isStreaming).toBe(true)
  })

  it('keeps loaded older messages in a session cache when load-more resolves after switching away', async () => {
    let resolveLoad!: (value: {
      messages: AgentIPCMessage[]
      offset: number
      limit: number
      hasMore: boolean
    }) => void
    const loadPromise = new Promise<{
      messages: AgentIPCMessage[]
      offset: number
      limit: number
      hasMore: boolean
    }>((resolve) => { resolveLoad = resolve })
    vi.stubGlobal('window', {
      api: {
        agent: {
          loadSessionMessagesPaginated: vi.fn(() => loadPromise),
        },
      },
    })

    const clientId = 'editor-history-a'
    const sdkId = 'sdk-history-a'
    const otherId = 'editor-history-b'
    const activeMessage = textMessage('active-existing', 'existing answer')
    const sessionA = {
      ...emptySlot(),
      currentSessionId: clientId,
      sdkSessionId: sdkId,
      messages: [activeMessage],
      _needsSdkLoad: true,
      _sdkLoadOffset: 10,
      _sdkLoadedCount: 10,
    }
    const sessionB = {
      ...emptySlot(),
      currentSessionId: otherId,
      messages: [textMessage('other-existing', 'other answer')],
    }

    useAgentStore.setState({
      activeSessionId: { editor: clientId, ask: null },
      slots: { editor: sessionA, ask: emptySlot() },
      sessionSlots: { [clientId]: sessionA, [otherId]: sessionB },
      sessionAccessOrder: [clientId, otherId],
      sessionList: [{ id: clientId, sdkSessionId: sdkId, context: 'editor', workspacePath: '/workspace' }],
    })

    const loading = useAgentStore.getState().loadMoreSessionMessages(clientId)
    await new Promise((resolve) => setTimeout(resolve, 0))
    useAgentStore.getState().switchToSession(otherId, 'editor')

    resolveLoad({
      messages: [{
        type: 'assistant',
        uuid: 'older-history',
        message: { content: [{ type: 'text', text: 'older answer' }] },
      }],
      offset: 11,
      limit: 100,
      hasMore: false,
    })
    await loading

    const state = useAgentStore.getState()
    expect(state.activeSessionId.editor).toBe(otherId)
    expect(state.slots.editor.messages.map((m) => m.id)).toEqual(['other-existing'])
    expect(state.sessionSlots[clientId].messages.map((m) => m.id)).toEqual(['older-history', 'active-existing'])
    expect(state.sessionSlots[clientId]._sdkLoadOffset).toBe(11)
    expect(state.sessionSlots[clientId]._needsSdkLoad).toBe(false)
    expect(state.sessionSlots[clientId]._isLoadingMoreMessages).toBe(false)
  })
})
