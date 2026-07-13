import { describe, expect, it } from 'vitest'
import type { AgentIPCMessage } from '../src/shared/types'
import { emptySlot } from '../src/renderer/store/agent-store'
import { reduceAgentMessage } from '../src/renderer/store/message-pipeline'

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
})
