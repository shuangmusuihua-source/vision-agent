import { describe, expect, it } from 'vitest'
import { createSessionEnvelope, withSessionEnvelope } from '../src/main/session-envelope'
import { scheduleTextBatch } from '../src/main/agent-text-batch'

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
