import { describe, it, expect } from 'vitest'
import { ensureAccumulator, commitAccumulator } from '../src/renderer/store/agent-store-impl'
import { emptySlot } from '../src/renderer/store/agent-store'
import type { ContentBlock, TextMessage } from '../src/shared/types'

function makeSlot() {
  const slot = emptySlot()
  slot.messages = [{
    kind: 'text' as const,
    id: 'msg-1',
    role: 'assistant' as const,
    phase: 'streaming' as const,
    textContent: 'hello',
    content: [],
    toolCalls: [],
    createdAt: Date.now(),
  }]
  return slot
}

describe('ensureAccumulator', () => {
  it('creates a new accumulator when none exists', () => {
    const slot = emptySlot()
    const acc = ensureAccumulator('msg-1', slot)
    expect(acc.messageId).toBe('msg-1')
    expect(acc.text).toBe('')
    expect(acc.toolUseBlocks.size).toBe(0)
  })

  it('reuses existing accumulator for the same messageId', () => {
    const slot = emptySlot()
    slot._acc = { messageId: 'msg-1', text: 'partial', toolUseBlocks: new Map(), thinkingText: '' }
    const acc = ensureAccumulator('msg-1', slot)
    expect(acc.text).toBe('partial')
  })

  it('creates new accumulator for different messageId', () => {
    const slot = emptySlot()
    slot._acc = { messageId: 'old', text: 'old', toolUseBlocks: new Map(), thinkingText: '' }
    const acc = ensureAccumulator('new', slot)
    expect(acc.messageId).toBe('new')
    expect(acc.text).toBe('')
  })
})

describe('commitAccumulator', () => {
  it('returns _acc:null when message not found', () => {
    const slot = emptySlot()
    const acc = ensureAccumulator('missing', slot)
    const result = commitAccumulator(acc, slot, [], 'complete')
    expect(result).toEqual({ _acc: null })
  })

  it('returns _acc:null when target is not a text message', () => {
    const slot = emptySlot()
    slot.messages = [{
      kind: 'user' as const, id: 'msg-1', role: 'user', textContent: 'hi', createdAt: 0,
    }]
    const acc = ensureAccumulator('msg-1', slot)
    const result = commitAccumulator(acc, slot, [], 'complete')
    expect(result).toEqual({ _acc: null })
  })

  it('commits accumulated text into the target message', () => {
    const slot = makeSlot()
    const acc = ensureAccumulator('msg-1', slot)
    acc.text = 'hello world'
    const result = commitAccumulator(acc, slot, [], 'complete')
    expect('messages' in result).toBe(true)
    const msg = (result as { messages: TextMessage[] }).messages[0]
    expect(msg.phase).toBe('complete')
    expect(msg.textContent).toBe('hello world')
  })

  it('clears the accumulator after commit', () => {
    const slot = makeSlot()
    const acc = ensureAccumulator('msg-1', slot)
    acc.text = 'done'
    const result = commitAccumulator(acc, slot, [], 'complete')
    expect((result as { _acc: null })._acc).toBeNull()
  })
})
