import type { BrowserWindow } from 'electron'
import type { SDKMessage, SDKPartialAssistantMessage } from '@anthropic-ai/claude-agent-sdk'
import type { AgentSessionEnvelope } from '../shared/types'

// ─── Text delta batching ──────────────────────────────────────────────
// Batch text_delta stream events to reduce IPC/re-render frequency.
// At typical streaming rates (40-80 tokens/sec), each token triggers:
//   1 IPC send → 1 Zustand set() → 1 ChatView + MessageBubble re-render
// By merging deltas within a 30ms window, we cut IPC events by ~3-4x
// while keeping perceived latency well below the ~100ms human threshold.
//
// Keyed by queryKey (sessionId || context) to support parallel streaming
// across multiple sessions within the same context.

type TextBatchEntry = { text: string; uuid: string }
const textBatches = new Map<string, { entries: TextBatchEntry[]; timer: ReturnType<typeof setTimeout> | null; envelope: AgentSessionEnvelope }>()

function ensureBatchSlot(key: string, envelope: AgentSessionEnvelope) {
  if (!textBatches.has(key)) {
    textBatches.set(key, { entries: [], timer: null, envelope })
  }
  return textBatches.get(key)!
}

export function flushTextBatch(key: string, win: BrowserWindow): void {
  const slot = textBatches.get(key)
  if (!slot || slot.entries.length === 0) return

  if (slot.timer) {
    clearTimeout(slot.timer)
    slot.timer = null
  }

  const combinedText = slot.entries.reduce((acc, e) => acc + e.text, '')
  const lastUuid = slot.entries[slot.entries.length - 1].uuid
  const envelope = slot.envelope
  slot.entries = []

  if (!combinedText || win.isDestroyed()) return

  // Emit a single combined stream_event carrying all accumulated text
  win.webContents.send('agent:event', {
    type: 'stream_event',
    uuid: lastUuid,
    event: {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: combinedText },
    },
    ...envelope,
  })
}

export function isTextDeltaEvent(rawMessage: SDKMessage): string | null {
  if (rawMessage.type !== 'stream_event') return null
  // After narrowing, rawMessage is SDKPartialAssistantMessage
  const event = (rawMessage as SDKPartialAssistantMessage).event
  if (event.type !== 'content_block_delta') return null
  const delta = event.delta
  if (delta.type !== 'text_delta') return null
  return delta.text || ''
}

export function scheduleTextBatch(
  key: string,
  text: string,
  uuid: string,
  win: BrowserWindow,
  envelope: AgentSessionEnvelope
): void {
  const slot = ensureBatchSlot(key, envelope)
  slot.entries.push({ text, uuid })
  slot.envelope = envelope

  if (!slot.timer) {
    slot.timer = setTimeout(() => flushTextBatch(key, win), 30)
  }
}

/** Flush any pending text batch for the given key (called during cleanup/abort) */
export function discardTextBatch(key: string): void {
  const slot = textBatches.get(key)
  if (slot) {
    if (slot.timer) clearTimeout(slot.timer)
    slot.timer = null
    slot.entries = []
  }
}

/** Discard pending text batches for all keys (called on window destroy) */
export function discardAllTextBatches(): void {
  for (const key of textBatches.keys()) {
    discardTextBatch(key)
  }
}
