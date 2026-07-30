import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAgentStore } from '../src/renderer/store/agent-store-impl'
import { emptySlot } from '../src/renderer/store/agent-store'
import { isAgentQueryActive } from '../src/renderer/store/agent-state-machine'
import { sessionListReducer } from '../src/renderer/store/session-protocol'
import type {
  AgentContext,
  AgentIPCMessage,
  AgentIPCMessageWithContext,
  AgentSessionEnvelope,
  ConversationMessage,
  SdkSessionInfo,
  SessionRoutedAskUserRequest,
  SessionRoutedGenerationActivity,
  SessionRoutedPermissionRequest,
  SessionRoutedRequestTimeout,
} from '../src/shared/types'

function resetStore() {
  useAgentStore.setState({
    context: 'editor',
    slots: { editor: emptySlot(), ask: emptySlot() },
    sessionList: [],
    sessionSlots: {},
    sessionAccessOrder: [],
    activeWorkspacePath: null,
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

function userMessage(id: string, text: string): ConversationMessage {
  return {
    kind: 'user',
    id,
    role: 'user',
    textContent: text,
    createdAt: 1,
  }
}

function interactionEnvelope(
  sessionId: string,
  context: AgentContext = 'editor',
): AgentSessionEnvelope {
  return {
    context,
    sessionId,
    workspacePath: context === 'ask' ? '/app/ask' : `/workspace/${sessionId}`,
  }
}

function permission(id: string, sessionId: string): SessionRoutedPermissionRequest {
  return {
    id,
    toolName: 'Write',
    input: { file_path: `/tmp/${id}.md` },
    ...interactionEnvelope(sessionId),
  }
}

function askUser(
  id: string,
  sessionId: string,
  context: AgentContext = 'editor',
): SessionRoutedAskUserRequest {
  return {
    id,
    questions: [{ question: 'Pick one', options: [], multiSelect: false }],
    ...interactionEnvelope(sessionId, context),
  }
}

function interactionTimeout(requestId: string, sessionId: string): SessionRoutedRequestTimeout {
  return {
    requestId,
    ...interactionEnvelope(sessionId),
  }
}

function sdkSession(id: string, workspacePath: string, lastModified = 1): SdkSessionInfo {
  return {
    id,
    sdkSessionId: `sdk-${id}`,
    title: id,
    workspacePath,
    context: 'editor',
    createdAt: lastModified,
    lastModified,
    messageCount: 1,
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

    useAgentStore.getState().handleAskUserTimeout(
      interactionTimeout('ask-bg', 'background-session'),
    )

    const state = useAgentStore.getState()
    expect(state.slots.editor.messages).toHaveLength(1)
    expect(state.sessionSlots['background-session'].askUserRequest).toBeNull()
    expect(state.sessionSlots['background-session'].messages.at(-1)?.kind).toBe('status')
    expect(state.sessionSlots['background-session'].agentState).toBe('error')
  })

  it('removes a queued background AskUser request when that request times out', () => {
    const currentRequest = askUser('ask-current', 'background-session')
    const queuedRequest = askUser('ask-queued', 'background-session')
    const background = {
      ...emptySlot(),
      currentSessionId: 'background-session',
      agentState: 'waitingForUserInput' as const,
      askUserRequest: currentRequest,
      askUserQueue: [queuedRequest],
    }

    useAgentStore.setState({
      activeSessionId: { editor: 'active-session', ask: null },
      slots: {
        editor: { ...emptySlot(), currentSessionId: 'active-session' },
        ask: emptySlot(),
      },
      sessionSlots: { 'background-session': background },
      sessionAccessOrder: ['background-session'],
    })

    useAgentStore.getState().handleAskUserTimeout(
      interactionTimeout('ask-queued', 'background-session'),
    )

    const state = useAgentStore.getState()
    expect(state.sessionSlots['background-session'].askUserRequest?.id).toBe('ask-current')
    expect(state.sessionSlots['background-session'].askUserQueue).toEqual([])
    expect(state.sessionSlots['background-session'].messages.at(-1)?.kind).toBe('status')
  })

  it('routes generation activity by session id instead of always writing to the visible context slot', () => {
    const active = { ...emptySlot(), currentSessionId: 'active-session' }
    const background = { ...emptySlot(), currentSessionId: 'background-session' }
    const output: SessionRoutedGenerationActivity = {
      activityId: 'tool:write-background',
      skillId: 'skill-1',
      phase: 'generating',
      source: 'tool-input',
      toolName: 'Write',
      label: '正在生成内容',
      content: '<html></html>',
      language: 'html',
      context: 'editor',
      sessionId: 'background-session',
      workspacePath: '/workspace/background',
    }

    useAgentStore.setState({
      activeSessionId: { editor: 'active-session', ask: null },
      slots: { editor: active, ask: emptySlot() },
      sessionSlots: { 'background-session': background },
      sessionAccessOrder: ['background-session'],
    })

    useAgentStore.getState().handleGenerationActivity(output)

    const state = useAgentStore.getState()
    expect(state.slots.editor.generationActivity).toBeNull()
    expect(state.sessionSlots['background-session'].generationActivity).toEqual(output)

    useAgentStore.getState().handleGenerationActivity({ ...output, phase: 'completed' })
    expect(useAgentStore.getState().sessionSlots['background-session'].generationActivity).toBeNull()
  })

  it('routes background assistant messages from the cached session when the visible editor slot is empty', async () => {
    const background = {
      ...emptySlot(),
      currentSessionId: 'background-session',
      agentState: 'running' as const,
      messages: [textMessage('bg-existing', 'background existing')],
    }
    const assistantMsg: AgentIPCMessageWithContext = {
      type: 'assistant',
      context: 'editor',
      sessionId: 'background-session',
      workspacePath: '/workspace/background',
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
    expect(isAgentQueryActive(state.sessionSlots['background-session'].agentState)).toBe(false)
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

  it('routes AskUser requests from their envelope instead of the visible store context', () => {
    const ask = {
      ...emptySlot(),
      currentSessionId: 'ask-session',
      agentState: 'running' as const,
    }

    useAgentStore.setState({
      context: 'editor',
      activeSessionId: { editor: null, ask: 'ask-session' },
      slots: { editor: emptySlot(), ask },
      sessionSlots: { 'ask-session': ask },
      sessionAccessOrder: ['ask-session'],
    })

    useAgentStore.getState().handleAskUserRequest(
      askUser('ask-home', 'ask-session', 'ask'),
    )

    const state = useAgentStore.getState()
    expect(state.slots.editor.askUserRequest).toBeNull()
    expect(state.slots.ask.askUserRequest?.id).toBe('ask-home')
    expect(state.slots.ask.agentState).toBe('waitingForUserInput')
  })

  it('keeps switched editor sessions isolated while background output and prompts arrive', async () => {
    const editorA = {
      ...emptySlot(),
      currentSessionId: 'editor-a',
      sdkSessionId: 'sdk-a',
      workspacePath: '/workspace/a',
      agentState: 'running' as const,
      messages: [{
        kind: 'user' as const,
        id: 'user-a',
        role: 'user' as const,
        textContent: 'question A',
        createdAt: 1,
      }],
    }
    const editorB = {
      ...emptySlot(),
      currentSessionId: 'editor-b',
      sdkSessionId: 'sdk-b',
      workspacePath: '/workspace/b',
      agentState: 'running' as const,
      messages: [{
        kind: 'user' as const,
        id: 'user-b',
        role: 'user' as const,
        textContent: 'question B',
        createdAt: 2,
      }],
    }

    useAgentStore.setState({
      activeSessionId: { editor: 'editor-a', ask: null },
      slots: { editor: editorA, ask: emptySlot() },
      sessionSlots: { 'editor-b': editorB },
      sessionAccessOrder: ['editor-b'],
    })

    useAgentStore.getState().switchToSession('editor-b', 'editor')
    useAgentStore.getState().handlePermissionRequest({
      ...permission('perm-b', 'editor-b'),
      sdkSessionId: 'sdk-b',
      workspacePath: '/workspace/b',
    })

    const streamA: AgentIPCMessageWithContext = {
      type: 'stream_event',
      context: 'editor',
      sessionId: 'editor-a',
      sdkSessionId: 'sdk-a',
      workspacePath: '/workspace/a',
      uuid: 'a-stream',
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'answer A' },
      },
    }
    const resultA: AgentIPCMessageWithContext = {
      type: 'result',
      subtype: 'success',
      context: 'editor',
      sessionId: 'editor-a',
      sdkSessionId: 'sdk-a',
      workspacePath: '/workspace/a',
      session_id: 'sdk-a',
    }

    useAgentStore.getState().processIPCMessage(streamA)
    useAgentStore.getState().processIPCMessage(resultA)
    await new Promise((resolve) => setTimeout(resolve, 0))

    const state = useAgentStore.getState()
    expect(state.activeSessionId.editor).toBe('editor-b')
    expect(state.slots.editor.currentSessionId).toBe('editor-b')
    expect(state.slots.editor.messages.map((m) => m.id)).toEqual(['user-b'])
    expect(state.slots.editor.permissionRequest?.id).toBe('perm-b')
    expect(state.slots.editor.workspacePath).toBe('/workspace/b')

    const sessionA = state.sessionSlots['editor-a']
    expect(sessionA.workspacePath).toBe('/workspace/a')
    expect(sessionA.messages[0].id).toBe('user-a')
    expect(sessionA.messages.some((m) => m.kind === 'text' && m.textContent === 'answer A')).toBe(true)
    expect(isAgentQueryActive(sessionA.agentState)).toBe(false)
    expect(sessionA.agentState).toBe('idle')
  })

  it('applies message projection and result FSM cleanup atomically', () => {
    useAgentStore.setState({
      slots: {
        editor: {
          ...emptySlot(),
          currentSessionId: 'atomic-session',
          agentState: 'thinking',
        },
        ask: emptySlot(),
      },
      activeSessionId: { editor: 'atomic-session', ask: null },
    })

    useAgentStore.getState().processIPCMessage({
      type: 'assistant',
      context: 'editor',
      sessionId: 'atomic-session',
      workspacePath: '/workspace/atomic',
      uuid: 'atomic-answer',
      message: { content: [{ type: 'text', text: 'done' }] },
    })
    useAgentStore.getState().processIPCMessage({
      type: 'result',
      subtype: 'success',
      context: 'editor',
      sessionId: 'atomic-session',
      workspacePath: '/workspace/atomic',
      session_id: 'sdk-atomic',
    })

    const slot = useAgentStore.getState().slots.editor
    expect(slot.agentState).toBe('idle')
    expect(isAgentQueryActive(slot.agentState)).toBe(false)
    expect(slot.messages).toHaveLength(1)
    expect(slot.messages[0]).toMatchObject({ id: 'atomic-answer', phase: 'complete' })
  })

  it('keeps the single Ask session running while switching editor sessions', () => {
    const ask = {
      ...emptySlot(),
      currentSessionId: 'ask-session',
      agentState: 'running' as const,
      messages: [textMessage('ask-msg', 'ask')],
    }
    const editorA = {
      ...emptySlot(),
      currentSessionId: 'editor-a',
      agentState: 'running' as const,
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

    const askMsg: AgentIPCMessageWithContext = {
      type: 'assistant',
      context: 'ask',
      sessionId: 'ask-session',
      workspacePath: '/app/ask',
      uuid: 'ask-new-msg',
      message: { content: [{ type: 'text', text: 'ask still running' }] },
    }
    const editorBMsg: AgentIPCMessageWithContext = {
      type: 'assistant',
      context: 'editor',
      sessionId: 'editor-b',
      workspacePath: '/workspace/b',
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
    expect(isAgentQueryActive(state.sessionSlots['editor-a'].agentState)).toBe(true)
  })

  it('keeps Ask and multi-workspace editor sessions isolated while concurrent background events arrive', async () => {
    const ask = {
      ...emptySlot(),
      currentSessionId: 'ask-session',
      sdkSessionId: 'sdk-ask',
      workspacePath: '/app/ask',
      agentState: 'running' as const,
      messages: [userMessage('ask-user', 'Ask sumi question')],
    }
    const editorA = {
      ...emptySlot(),
      currentSessionId: 'editor-a',
      sdkSessionId: 'sdk-a',
      workspacePath: '/workspace/a',
      agentState: 'running' as const,
      messages: [userMessage('user-a', 'question A')],
    }
    const editorB = {
      ...emptySlot(),
      currentSessionId: 'editor-b',
      sdkSessionId: 'sdk-b',
      workspacePath: '/workspace/b',
      agentState: 'running' as const,
      messages: [userMessage('user-b', 'question B')],
    }

    useAgentStore.setState({
      activeWorkspacePath: '/workspace/a',
      activeSessionId: { editor: 'editor-a', ask: 'ask-session' },
      slots: { editor: editorA, ask },
      sessionSlots: {
        'editor-a': editorA,
        'editor-b': editorB,
        'ask-session': ask,
      },
      sessionAccessOrder: ['editor-a', 'editor-b', 'ask-session'],
      sessionList: [
        { id: 'editor-a', sdkSessionId: 'sdk-a', context: 'editor', workspacePath: '/workspace/a' },
        { id: 'editor-b', sdkSessionId: 'sdk-b', context: 'editor', workspacePath: '/workspace/b' },
        { id: 'ask-session', sdkSessionId: 'sdk-ask', context: 'ask', workspacePath: '/app/ask' },
      ],
    })

    useAgentStore.getState().switchToSession('editor-b', 'editor', '/workspace/b')
    useAgentStore.getState().setActiveWorkspace('/workspace/b')

    useAgentStore.getState().handlePermissionRequest({
      ...permission('perm-a', 'editor-a'),
      sdkSessionId: 'sdk-a',
      workspacePath: '/workspace/a',
    })
    useAgentStore.getState().handleAskUserRequest({
      ...askUser('ask-user-a', 'editor-a'),
      sdkSessionId: 'sdk-a',
      workspacePath: '/workspace/a',
    })
    useAgentStore.getState().handleGenerationActivity({
      activityId: 'tool:write-a',
      skillId: 'slides',
      phase: 'generating',
      source: 'tool-input',
      toolName: 'Write',
      label: '正在生成内容',
      content: '<html>workspace A slides</html>',
      language: 'html',
      context: 'editor',
      sessionId: 'editor-a',
      sdkSessionId: 'sdk-a',
      workspacePath: '/workspace/a',
    })

    const editorAAnswer: AgentIPCMessageWithContext = {
      type: 'assistant',
      context: 'editor',
      sessionId: 'editor-a',
      sdkSessionId: 'sdk-a',
      workspacePath: '/workspace/a',
      uuid: 'assistant-a',
      message: { content: [{ type: 'text', text: 'answer A' }] },
    }
    const editorBAnswer: AgentIPCMessageWithContext = {
      type: 'assistant',
      context: 'editor',
      sessionId: 'editor-b',
      sdkSessionId: 'sdk-b',
      workspacePath: '/workspace/b',
      uuid: 'assistant-b',
      message: { content: [{ type: 'text', text: 'answer B' }] },
    }
    const askAnswer: AgentIPCMessageWithContext = {
      type: 'assistant',
      context: 'ask',
      sessionId: 'ask-session',
      sdkSessionId: 'sdk-ask',
      workspacePath: '/app/ask',
      uuid: 'assistant-ask',
      message: { content: [{ type: 'text', text: 'ask answer' }] },
    }
    const editorBResult: AgentIPCMessageWithContext = {
      type: 'result',
      subtype: 'success',
      context: 'editor',
      sessionId: 'editor-b',
      sdkSessionId: 'sdk-b',
      workspacePath: '/workspace/b',
      session_id: 'sdk-b',
    }

    useAgentStore.getState().processIPCMessage(editorAAnswer)
    useAgentStore.getState().processIPCMessage(editorBAnswer)
    useAgentStore.getState().processIPCMessage(askAnswer)
    useAgentStore.getState().processIPCMessage(editorBResult)
    await new Promise((resolve) => setTimeout(resolve, 0))

    const state = useAgentStore.getState()
    expect(state.activeSessionId.editor).toBe('editor-b')
    expect(state.activeWorkspacePath).toBe('/workspace/b')
    expect(state.slots.editor.currentSessionId).toBe('editor-b')
    expect(state.slots.editor.workspacePath).toBe('/workspace/b')
    expect(state.slots.editor.messages.map((m) => m.id)).toEqual(['user-b', 'assistant-b'])
    expect(state.slots.editor.permissionRequest).toBeNull()
    expect(state.slots.editor.askUserRequest).toBeNull()
    expect(state.slots.editor.generationActivity).toBeNull()
    expect(state.slots.editor.agentState).toBe('idle')
    expect(isAgentQueryActive(state.slots.editor.agentState)).toBe(false)

    const sessionA = state.sessionSlots['editor-a']
    expect(sessionA.workspacePath).toBe('/workspace/a')
    expect(sessionA.messages.map((m) => m.id)).toEqual(['user-a', 'assistant-a'])
    expect(sessionA.permissionRequest?.id).toBe('perm-a')
    expect(sessionA.askUserRequest?.id).toBe('ask-user-a')
    expect(sessionA.generationActivity?.content).toBe('<html>workspace A slides</html>')
    expect(sessionA.agentState).toBe('waitingForUserInput')
    expect(isAgentQueryActive(sessionA.agentState)).toBe(true)

    expect(state.activeSessionId.ask).toBe('ask-session')
    expect(state.slots.ask.workspacePath).toBe('/app/ask')
    expect(state.slots.ask.messages.map((m) => m.id)).toEqual(['ask-user', 'assistant-ask'])
    expect(state.slots.ask.agentState).toBe('running')
    expect(state.sessionSlots['ask-session'].messages.map((m) => m.id)).toEqual(['ask-user', 'assistant-ask'])
  })

  it('preserves the previous session workspace when switching across workspaces', () => {
    const sessionA = {
      ...emptySlot(),
      currentSessionId: 'session-a',
      workspacePath: '/workspace-a',
      messages: [textMessage('a-msg', 'A')],
    }
    const sessionB = {
      ...emptySlot(),
      currentSessionId: 'session-b',
      workspacePath: '/workspace-b',
      messages: [textMessage('b-msg', 'B')],
    }

    useAgentStore.setState({
      activeWorkspacePath: '/workspace-a',
      activeSessionId: { editor: 'session-a', ask: null },
      slots: { editor: sessionA, ask: emptySlot() },
      sessionSlots: { 'session-a': sessionA, 'session-b': sessionB },
      sessionAccessOrder: ['session-a', 'session-b'],
      sessionList: [
        { id: 'session-a', context: 'editor', workspacePath: '/workspace-a' },
        { id: 'session-b', context: 'editor', workspacePath: '/workspace-b' },
      ],
    })

    useAgentStore.getState().switchToSession('session-b', 'editor', '/workspace-b')
    useAgentStore.getState().setActiveWorkspace('/workspace-b')

    const state = useAgentStore.getState()
    expect(state.sessionSlots['session-a'].workspacePath).toBe('/workspace-a')
    expect(state.sessionSlots['session-b'].workspacePath).toBe('/workspace-b')
    expect(state.slots.editor.currentSessionId).toBe('session-b')
    expect(state.slots.editor.workspacePath).toBe('/workspace-b')
    expect(state.activeWorkspacePath).toBe('/workspace-b')
  })

  it('keeps linked files isolated per editor session', () => {
    const sessionA = {
      ...emptySlot(),
      currentSessionId: 'session-a',
      workspacePath: '/workspace-a',
      linkedFile: '/workspace-a/a.md',
      messages: [textMessage('a-msg', 'A')],
    }
    const sessionB = {
      ...emptySlot(),
      currentSessionId: 'session-b',
      workspacePath: '/workspace-b',
      linkedFile: '/workspace-b/b.md',
      messages: [textMessage('b-msg', 'B')],
    }

    useAgentStore.setState({
      activeWorkspacePath: '/workspace-a',
      activeSessionId: { editor: 'session-a', ask: null },
      slots: { editor: sessionA, ask: emptySlot() },
      sessionSlots: { 'session-a': sessionA, 'session-b': sessionB },
      sessionAccessOrder: ['session-a', 'session-b'],
    })

    useAgentStore.getState().switchToSession('session-b', 'editor', '/workspace-b')
    expect(useAgentStore.getState().slots.editor.linkedFile).toBe('/workspace-b/b.md')

    useAgentStore.setState((state) => ({
      slots: {
        ...state.slots,
        editor: { ...state.slots.editor, linkedFile: '/workspace-b/b-updated.md' },
      },
      sessionSlots: {
        ...state.sessionSlots,
        'session-b': { ...state.sessionSlots['session-b'], linkedFile: '/workspace-b/b-updated.md' },
      },
    }))

    useAgentStore.getState().switchToSession('session-a', 'editor', '/workspace-a')

    const state = useAgentStore.getState()
    expect(state.slots.editor.linkedFile).toBe('/workspace-a/a.md')
    expect(state.sessionSlots['session-a'].linkedFile).toBe('/workspace-a/a.md')
    expect(state.sessionSlots['session-b'].linkedFile).toBe('/workspace-b/b-updated.md')
  })

  it('routes pre-materialized Ask events by app session ID', () => {
    const tempId = 'new-ask-1'
    const editor = { ...emptySlot(), currentSessionId: 'editor-session', messages: [textMessage('editor-msg', 'editor')] }
    const ask = { ...emptySlot(), currentSessionId: tempId }
    const assistantMsg: AgentIPCMessageWithContext = {
      type: 'assistant',
      context: 'ask',
      sessionId: tempId,
      workspacePath: '/app/ask',
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

  it('renames an app-owned empty session through the session protocol', () => {
    const initial = [sdkSession('new-editor-1', '/workspace', 1)]

    const next = sessionListReducer(initial, {
      type: 'RENAME',
      sessionId: 'new-editor-1',
      title: '新的会话名称',
    })

    expect(next[0].title).toBe('新的会话名称')
    expect(next[0].id).toBe('new-editor-1')
  })

  it('keeps unrelated workspace session order when another workspace refreshes from SDK', () => {
    const productSessions = [
      sdkSession('product-1', '/new-product', 10),
      sdkSession('product-2', '/new-product', 20),
      sdkSession('product-3', '/new-product', 30),
      sdkSession('product-4', '/new-product', 40),
      sdkSession('product-5', '/new-product', 50),
    ]
    const state = [
      ...productSessions,
      sdkSession('nextai-1', '/nextai', 1),
      sdkSession('teacher-1', '/teacher', 1),
    ]

    const next = sessionListReducer(state, {
      type: 'REPLACE_SDK',
      workspacePath: '/nextai',
      sessions: [
        sdkSession('product-5', '/new-product', 500),
        sdkSession('product-4', '/new-product', 400),
        sdkSession('nextai-1', '/nextai', 100),
      ],
    })

    expect(next.filter(s => s.workspacePath === '/new-product').map(s => s.id)).toEqual([
      'product-1',
      'product-2',
      'product-3',
      'product-4',
      'product-5',
    ])
    expect(next.find(s => s.id === 'product-5')?.lastModified).toBe(50)
    expect(next.find(s => s.id === 'nextai-1')?.lastModified).toBe(100)
  })

  it('updates refreshed metadata without replacing the user-owned session title', () => {
    const state = [
      sdkSession('product-1', '/new-product', 10),
      sdkSession('product-2', '/new-product', 20),
      sdkSession('product-3', '/new-product', 30),
      sdkSession('nextai-1', '/nextai', 1),
    ]

    const next = sessionListReducer(state, {
      type: 'REPLACE_SDK',
      workspacePath: '/new-product',
      sessions: [
        { ...sdkSession('product-3', '/new-product', 300), title: 'updated 3' },
        { ...sdkSession('product-1', '/new-product', 100), title: 'updated 1' },
        { ...sdkSession('product-2', '/new-product', 200), title: 'updated 2' },
      ],
    })

    expect(next.filter(s => s.workspacePath === '/new-product').map(s => s.id)).toEqual([
      'product-1',
      'product-2',
      'product-3',
    ])
    expect(next.find(s => s.id === 'product-2')?.title).toBe('product-2')
    expect(next.find(s => s.id === 'nextai-1')?.lastModified).toBe(1)
  })

  it('keeps an editor session keyed by app session ID after SDK materialization', async () => {
    const appSessionId = 'new-editor-a'
    const sdkId = 'sdk-editor-a'
    const userMsg: ConversationMessage = {
      kind: 'user',
      id: 'user-a',
      role: 'user',
      textContent: 'question A',
      createdAt: 1,
    }

    useAgentStore.setState({
      activeSessionId: { editor: appSessionId, ask: null },
      slots: {
        editor: {
          ...emptySlot(),
          currentSessionId: appSessionId,
          agentState: 'thinking',
          messages: [userMsg],
        },
        ask: emptySlot(),
      },
      sessionSlots: {
        [appSessionId]: {
          ...emptySlot(),
          currentSessionId: appSessionId,
          agentState: 'thinking',
          messages: [userMsg],
        },
      },
      sessionAccessOrder: [appSessionId],
      sessionList: [{
        id: appSessionId,
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
      tempId: appSessionId,
      realId: sdkId,
      context: 'editor',
      workspacePath: '/workspace',
      title: 'A',
    })
    useAgentStore.setState((state) => ({
      sessionSlots: {
        ...state.sessionSlots,
        [appSessionId]: {
          ...state.sessionSlots[appSessionId],
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
      sessionId: appSessionId,
      sdkSessionId: sdkId,
      workspacePath: '/workspace/a',
      uuid: 'assistant-a',
      message: { content: [{ type: 'text', text: 'answer A' }] },
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    const state = useAgentStore.getState()
    expect(state.sessionList.find(s => s.id === appSessionId)?.sdkSessionId).toBe(sdkId)
    expect(state.sessionSlots[appSessionId].messages.map((m) => m.id)).toEqual(['user-a', 'assistant-a'])
    expect(state.sessionSlots[appSessionId].currentSessionId).toBe(appSessionId)
    expect(state.sessionSlots[appSessionId].sdkSessionId).toBe(sdkId)
  })

  it('does not wipe optimistic messages when initial SDK history load resolves after a send', async () => {
    let resolveLoad!: (value: {
      messages: AgentIPCMessage[]
      cursor: string | null
      limit: number
      hasMore: boolean
    }) => void
    const loadPromise = new Promise<{
      messages: AgentIPCMessage[]
      cursor: string | null
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

    const appSessionId = 'new-editor-race'
    const sdkId = 'sdk-editor-race'
    const initialSlot = {
      ...emptySlot(),
      currentSessionId: appSessionId,
      sdkSessionId: sdkId,
      _needsSdkLoad: true,
    }

    useAgentStore.setState({
      activeSessionId: { editor: appSessionId, ask: null },
      slots: { editor: initialSlot, ask: emptySlot() },
      sessionSlots: { [appSessionId]: initialSlot },
      sessionAccessOrder: [appSessionId],
      sessionList: [{ id: appSessionId, sdkSessionId: sdkId, context: 'editor', workspacePath: '/workspace' }],
    })

    const loading = useAgentStore.getState().loadInitialSessionMessages(appSessionId, 'editor')
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
        },
      },
      sessionSlots: {
        ...state.sessionSlots,
        [appSessionId]: {
          ...state.sessionSlots[appSessionId],
          messages: [optimisticUser],
          agentState: 'thinking',
        },
      },
    }))

    resolveLoad({
      messages: [{
        type: 'assistant',
        uuid: 'assistant-history',
        message: { content: [{ type: 'text', text: 'historical answer' }] },
      }],
      cursor: null,
      limit: 10,
      hasMore: false,
    })
    await loading

    const state = useAgentStore.getState()
    expect(state.slots.editor.messages.map((m) => m.id)).toEqual(['assistant-history', 'user-live'])
    expect(state.sessionSlots[appSessionId].messages.map((m) => m.id)).toEqual(['assistant-history', 'user-live'])
    expect(state.slots.editor.agentState).toBe('thinking')
    expect(isAgentQueryActive(state.slots.editor.agentState)).toBe(true)
  })

  it('keeps loaded older messages in a session cache when load-more resolves after switching away', async () => {
    let resolveLoad!: (value: {
      messages: AgentIPCMessage[]
      cursor: string | null
      limit: number
      hasMore: boolean
    }) => void
    const loadPromise = new Promise<{
      messages: AgentIPCMessage[]
      cursor: string | null
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

    const appSessionId = 'editor-history-a'
    const sdkId = 'sdk-history-a'
    const otherId = 'editor-history-b'
    const activeMessage = textMessage('active-existing', 'existing answer')
    const sessionA = {
      ...emptySlot(),
      currentSessionId: appSessionId,
      sdkSessionId: sdkId,
      messages: [activeMessage],
      _needsSdkLoad: true,
      _sessionPageCursor: 'sdk:10',
    }
    const sessionB = {
      ...emptySlot(),
      currentSessionId: otherId,
      messages: [textMessage('other-existing', 'other answer')],
    }

    useAgentStore.setState({
      activeSessionId: { editor: appSessionId, ask: null },
      slots: { editor: sessionA, ask: emptySlot() },
      sessionSlots: { [appSessionId]: sessionA, [otherId]: sessionB },
      sessionAccessOrder: [appSessionId, otherId],
      sessionList: [{ id: appSessionId, sdkSessionId: sdkId, context: 'editor', workspacePath: '/workspace' }],
    })

    const loading = useAgentStore.getState().loadMoreSessionMessages(appSessionId)
    await new Promise((resolve) => setTimeout(resolve, 0))
    useAgentStore.getState().switchToSession(otherId, 'editor')

    resolveLoad({
      messages: [{
        type: 'assistant',
        uuid: 'older-history',
        message: { content: [{ type: 'text', text: 'older answer' }] },
      }],
      cursor: null,
      limit: 100,
      hasMore: false,
    })
    await loading

    const state = useAgentStore.getState()
    expect(state.activeSessionId.editor).toBe(otherId)
    expect(state.slots.editor.messages.map((m) => m.id)).toEqual(['other-existing'])
    expect(state.sessionSlots[appSessionId].messages.map((m) => m.id)).toEqual(['older-history', 'active-existing'])
    expect(state.sessionSlots[appSessionId]._sessionPageCursor).toBeNull()
    expect(state.sessionSlots[appSessionId]._needsSdkLoad).toBe(false)
    expect(state.sessionSlots[appSessionId]._isLoadingMoreMessages).toBe(false)
  })
})
