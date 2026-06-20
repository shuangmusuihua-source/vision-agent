import { describe, expect, it } from 'vitest'
import { createSessionEnvelope, withSessionEnvelope } from '../src/main/session-envelope'
import { scheduleTextBatch } from '../src/main/agent-text-batch'
import { SessionRuntimeController } from '../src/main/session-runtime'
import { resolveAskUser, resolvePermission } from '../src/main/agent-permissions'

function fakeWindow() {
  const sent: Array<{ channel: string; payload: unknown }> = []
  return {
    sent,
    win: {
      isDestroyed: () => false,
      webContents: {
        send: (channel: string, payload: unknown) => {
          sent.push({ channel, payload })
        },
      },
    },
  }
}

describe('session event envelope', () => {
  it('creates an app-owned routing envelope separate from the SDK session id', () => {
    const envelope = createSessionEnvelope({
      context: 'editor',
      sessionId: 'app-session-a',
      sdkSessionId: 'sdk-session-a',
      workspacePath: '/workspace/a',
    })

    expect(envelope).toEqual({
      context: 'editor',
      sessionId: 'app-session-a',
      clientSessionKey: 'app-session-a',
      sdkSessionId: 'sdk-session-a',
      workspacePath: '/workspace/a',
    })
  })

  it('envelope fields override conflicting payload routing fields', () => {
    const envelope = createSessionEnvelope({
      context: 'ask',
      sessionId: 'ask-session',
      workspacePath: '/app/ask',
    })

    const payload = withSessionEnvelope(envelope, {
      type: 'result',
      sessionId: 'wrong-session',
      context: 'editor',
    })

    expect(payload.sessionId).toBe('ask-session')
    expect(payload.clientSessionKey).toBe('ask-session')
    expect(payload.context).toBe('ask')
    expect(payload.workspacePath).toBe('/app/ask')
  })

  it('text batching emits session-scoped agent events', async () => {
    const { win, sent } = fakeWindow()
    const envelope = createSessionEnvelope({
      context: 'editor',
      sessionId: 'session-a',
      sdkSessionId: 'sdk-a',
      workspacePath: '/workspace/a',
    })

    scheduleTextBatch('session-a', 'hello ', 'uuid-1', win as never, envelope)
    scheduleTextBatch('session-a', 'world', 'uuid-2', win as never, envelope)
    await new Promise((resolve) => setTimeout(resolve, 40))

    expect(sent).toHaveLength(1)
    expect(sent[0].channel).toBe('agent:event')
    expect(sent[0].payload).toMatchObject({
      context: 'editor',
      sessionId: 'session-a',
      clientSessionKey: 'session-a',
      sdkSessionId: 'sdk-a',
      workspacePath: '/workspace/a',
      type: 'stream_event',
      uuid: 'uuid-2',
      event: {
        delta: { text: 'hello world' },
      },
    })
  })
})

describe('session runtime event routing', () => {
  it('emits converted SDK messages with the session envelope', () => {
    const { win, sent } = fakeWindow()
    const runtime = new SessionRuntimeController()
    const envelope = createSessionEnvelope({
      context: 'editor',
      sessionId: 'app-session-a',
      sdkSessionId: 'sdk-session-a',
      workspacePath: '/workspace/a',
    })

    runtime.emitSdkMessage(win as never, 'app-session-a', envelope, {
      type: 'assistant',
      uuid: 'assistant-1',
      message: {
        content: [{ type: 'text', text: 'hello from sdk' }],
      },
    } as never)

    expect(sent).toHaveLength(1)
    expect(sent[0].channel).toBe('agent:event')
    expect(sent[0].payload).toMatchObject({
      context: 'editor',
      sessionId: 'app-session-a',
      clientSessionKey: 'app-session-a',
      sdkSessionId: 'sdk-session-a',
      workspacePath: '/workspace/a',
      type: 'assistant',
      uuid: 'assistant-1',
      message: {
        content: [{ type: 'text', text: 'hello from sdk' }],
      },
    })
  })

  it('batches SDK text deltas with the session envelope', async () => {
    const { win, sent } = fakeWindow()
    const runtime = new SessionRuntimeController()
    const envelope = createSessionEnvelope({
      context: 'editor',
      sessionId: 'app-session-text',
      sdkSessionId: 'sdk-session-text',
      workspacePath: '/workspace/text',
    })

    runtime.emitSdkMessage(win as never, 'app-session-text', envelope, {
      type: 'stream_event',
      uuid: 'delta-1',
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'hello ' },
      },
    } as never)
    runtime.emitSdkMessage(win as never, 'app-session-text', envelope, {
      type: 'stream_event',
      uuid: 'delta-2',
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'world' },
      },
    } as never)
    await new Promise((resolve) => setTimeout(resolve, 40))

    expect(sent).toHaveLength(1)
    expect(sent[0].channel).toBe('agent:event')
    expect(sent[0].payload).toMatchObject({
      context: 'editor',
      sessionId: 'app-session-text',
      clientSessionKey: 'app-session-text',
      sdkSessionId: 'sdk-session-text',
      workspacePath: '/workspace/text',
      type: 'stream_event',
      uuid: 'delta-2',
      event: {
        delta: { text: 'hello world' },
      },
    })
  })

  it('emits execution errors with the session envelope', () => {
    const { win, sent } = fakeWindow()
    const runtime = new SessionRuntimeController()
    const envelope = createSessionEnvelope({
      context: 'ask',
      sessionId: 'ask-session',
      workspacePath: '/app/ask',
    })

    runtime.emitExecutionError(win as never, envelope, 'network failed')

    expect(sent).toHaveLength(1)
    expect(sent[0].channel).toBe('agent:event')
    expect(sent[0].payload).toMatchObject({
      context: 'ask',
      sessionId: 'ask-session',
      clientSessionKey: 'ask-session',
      workspacePath: '/app/ask',
      type: 'result',
      subtype: 'error_during_execution',
      errors: ['network failed'],
    })
  })

  it('resolves event envelopes from the active runtime run', () => {
    const runtime = new SessionRuntimeController()
    const envelope = createSessionEnvelope({
      context: 'editor',
      sessionId: 'app-session-materialized',
      workspacePath: '/workspace/materialized',
    })
    runtime.registerRun({
      query: {} as never,
      skillId: null,
      abortController: new AbortController(),
      envelope,
    })

    runtime.materializeSdkSession('app-session-materialized', 'sdk-real')

    expect(runtime.resolveEventEnvelope('app-session-materialized', {
      context: 'ask',
      sessionId: 'fallback',
      clientSessionKey: 'fallback',
      workspacePath: '/fallback',
    })).toEqual({
      context: 'editor',
      sessionId: 'app-session-materialized',
      clientSessionKey: 'app-session-materialized',
      sdkSessionId: 'sdk-real',
      workspacePath: '/workspace/materialized',
    })
  })

  it('finalizes a run by flushing pending text before cleanup', () => {
    const { win, sent } = fakeWindow()
    const runtime = new SessionRuntimeController()
    const envelope = createSessionEnvelope({
      context: 'editor',
      sessionId: 'app-session-finalize',
      sdkSessionId: 'sdk-finalize',
      workspacePath: '/workspace/finalize',
    })
    const instanceId = runtime.registerRun({
      query: {} as never,
      skillId: null,
      abortController: new AbortController(),
      envelope,
    })

    runtime.emitSdkMessage(win as never, 'app-session-finalize', envelope, {
      type: 'stream_event',
      uuid: 'pending-delta',
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'flush me' },
      },
    } as never)
    runtime.finalizeRun(win as never, 'app-session-finalize', instanceId)

    expect(sent).toHaveLength(1)
    expect(sent[0].payload).toMatchObject({
      sessionId: 'app-session-finalize',
      sdkSessionId: 'sdk-finalize',
      event: {
        delta: { text: 'flush me' },
      },
    })
    expect(runtime.getEnvelope('app-session-finalize')).toBeNull()
  })

  it('owns AskUser pending request registration and resolution', async () => {
    const { win, sent } = fakeWindow()
    const runtime = new SessionRuntimeController()
    const envelope = createSessionEnvelope({
      context: 'editor',
      sessionId: 'app-session-ask-user',
      sdkSessionId: 'sdk-ask-user',
      workspacePath: '/workspace/ask-user',
    })

    const pending = runtime.requestAskUserAnswer(win as never, envelope, {
      questions: [{
        question: 'Pick one',
        header: 'Choice',
        options: [{ label: 'A', description: 'First' }],
        multiSelect: false,
      }],
      question: 'Pick one',
      header: 'Choice',
      options: [{ label: 'A', description: 'First' }],
      multiSelect: false,
    }, { questions: [] })

    expect(sent).toHaveLength(1)
    expect(sent[0].channel).toBe('agent:askUser')
    expect(sent[0].payload).toMatchObject({
      context: 'editor',
      sessionId: 'app-session-ask-user',
      sdkSessionId: 'sdk-ask-user',
      workspacePath: '/workspace/ask-user',
      question: 'Pick one',
    })

    const requestId = (sent[0].payload as { id: string }).id
    resolveAskUser(requestId, { Choice: 'A' })

    await expect(pending).resolves.toMatchObject({
      behavior: 'allow',
      updatedInput: {
        answers: { Choice: 'A' },
      },
    })
  })

  it('owns permission pending request registration and resolution', async () => {
    const { win, sent } = fakeWindow()
    const runtime = new SessionRuntimeController()
    const envelope = createSessionEnvelope({
      context: 'editor',
      sessionId: 'app-session-permission',
      sdkSessionId: 'sdk-permission',
      workspacePath: '/workspace/permission',
    })
    const input = { file_path: '/workspace/permission/file.md' }

    const pending = runtime.requestPermissionApproval(win as never, envelope, {
      toolName: 'Write',
      input,
      title: 'Write file',
      displayName: 'Write',
    })

    expect(sent).toHaveLength(1)
    expect(sent[0].channel).toBe('agent:permissionRequest')
    expect(sent[0].payload).toMatchObject({
      context: 'editor',
      sessionId: 'app-session-permission',
      sdkSessionId: 'sdk-permission',
      workspacePath: '/workspace/permission',
      toolName: 'Write',
      input,
    })

    const requestId = (sent[0].payload as { id: string }).id
    resolvePermission(requestId, 'allow')

    await expect(pending).resolves.toMatchObject({
      behavior: 'allow',
      updatedInput: input,
    })
  })
})
