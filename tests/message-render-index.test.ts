import { describe, expect, it } from 'vitest'
import type { ConversationMessage } from '../src/shared/types'
import { buildMessageRenderIndex } from '../src/renderer/components/chat/message-render-index'

function userMessage(id: string): ConversationMessage {
  return {
    id,
    kind: 'user',
    textContent: id,
    timestamp: 1,
  }
}

function assistantMessage(id: string): ConversationMessage {
  return {
    id,
    kind: 'text',
    textContent: id,
    toolCalls: [],
    phase: 'complete',
    timestamp: 1,
  }
}

describe('message render index', () => {
  it('finds the latest user message once for an active query', () => {
    const messages = [
      userMessage('user-1'),
      assistantMessage('assistant-1'),
      userMessage('user-2'),
      assistantMessage('assistant-2'),
    ]

    expect(buildMessageRenderIndex(messages, true)).toEqual({
      latestStreamingUserMessageId: 'user-2',
    })
  })

  it('does not mark a user message once the query is inactive', () => {
    expect(buildMessageRenderIndex([userMessage('user-1')], false)).toEqual({
      latestStreamingUserMessageId: null,
    })
  })
})
