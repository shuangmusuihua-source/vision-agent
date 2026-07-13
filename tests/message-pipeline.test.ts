import { describe, expect, it } from 'vitest'
import type { AgentIPCMessage } from '../src/shared/types'
import { emptySlot } from '../src/renderer/store/agent-store'
import { buildReplayedMessages, reduceAgentMessage } from '../src/renderer/store/message-pipeline'

describe('reduceAgentMessage', () => {
  it('projects a live assistant message and emits the first-content event', () => {
    const message: AgentIPCMessage = {
      type: 'assistant',
      uuid: 'assistant-1',
      message: { content: [{ type: 'text', text: 'hello' }] },
    }

    const result = reduceAgentMessage(emptySlot(), message, 'live')

    expect(result.patch?.messages).toHaveLength(1)
    expect(result.patch?.messages?.[0]).toMatchObject({
      id: 'assistant-1',
      textContent: 'hello',
    })
    expect(result.events).toEqual([{ type: 'FIRST_CONTENT' }])
  })

  it('restores replay content without driving the live FSM', () => {
    const message: AgentIPCMessage = {
      type: 'assistant',
      uuid: 'assistant-history',
      message: { content: [{ type: 'text', text: 'history' }] },
    }

    const result = reduceAgentMessage(emptySlot(), message, 'replay')

    expect(result.patch?.messages?.[0]).toMatchObject({ textContent: 'history' })
    expect(result.events).toEqual([])
  })

  it('ignores streaming deltas during replay', () => {
    const message: AgentIPCMessage = {
      type: 'stream_event',
      uuid: 'stream-history',
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'ignored' },
      },
    }

    expect(reduceAgentMessage(emptySlot(), message, 'replay')).toEqual({
      patch: null,
      events: [],
      firstContentSeenDuringThisCall: false,
    })
  })

  it('keeps the abort guard inside the pipeline result semantics', () => {
    const slot = {
      ...emptySlot(),
      _queryGeneration: 2,
      _resultGuardGen: 1,
    }
    const message = {
      type: 'result',
      subtype: 'error_during_execution',
      errors: ['aborted'],
      usage: { input_tokens: 0, output_tokens: 0 },
    } as AgentIPCMessage

    expect(reduceAgentMessage(slot, message, 'live')).toEqual({
      patch: null,
      events: [],
      firstContentSeenDuringThisCall: false,
    })
  })

  it('uses the same tool-result projection for live delivery and replay', () => {
    const messages: AgentIPCMessage[] = [{
      type: 'assistant',
      uuid: 'tool-answer',
      message: {
        content: [
          { type: 'text', text: 'working' },
          { type: 'tool_use', id: 'tool-1', name: 'Read', input: { file_path: '/tmp/a.md' } },
        ],
      },
    }, {
      type: 'user',
      uuid: 'tool-result',
      message: {
        content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'contents' }],
      },
    }]

    let liveSlot = emptySlot()
    for (const message of messages) {
      const { patch } = reduceAgentMessage(liveSlot, message, 'live')
      if (patch) liveSlot = { ...liveSlot, ...patch }
    }

    expect(buildReplayedMessages(messages)).toEqual(liveSlot.messages)
    expect(liveSlot.messages[0]).toMatchObject({
      toolCalls: [{ toolUseId: 'tool-1', status: 'completed', result: 'contents' }],
    })
  })

  it('restores result diagnostics through the shared projection rules', () => {
    const messages = buildReplayedMessages([{
      type: 'result',
      subtype: 'success',
      stop_reason: 'max_tokens',
      session_id: 'sdk-session',
      usage: { input_tokens: 1, output_tokens: 2 },
      total_cost_usd: 0,
      duration_ms: 1,
    } as AgentIPCMessage])

    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({
      kind: 'stopped',
      textContent: expect.stringContaining('达到最大输出长度'),
    })
  })
})
