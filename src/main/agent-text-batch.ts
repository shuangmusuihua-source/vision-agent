import { BrowserWindow } from 'electron'
import type { AgentContext } from '../shared/types'

// ─── Text delta batching ──────────────────────────────────────────────
// Batch text_delta stream events to reduce IPC/re-render frequency.
// At typical streaming rates (40-80 tokens/sec), each token triggers:
//   1 IPC send → 1 Zustand set() → 1 ChatView + MessageBubble re-render
// By merging deltas within a 30ms window, we cut IPC events by ~3-4x
// while keeping perceived latency well below the ~100ms human threshold.

type TextBatchEntry = { context: AgentContext; text: string; uuid: string }
const textBatches = new Map<AgentContext, { entries: TextBatchEntry[]; timer: ReturnType<typeof setTimeout> | null }>()

function ensureBatchSlot(ctx: AgentContext) {
  if (!textBatches.has(ctx)) {
    textBatches.set(ctx, { entries: [], timer: null })
  }
  return textBatches.get(ctx)!
}

export function flushTextBatch(ctx: AgentContext, win: BrowserWindow): void {
  const slot = textBatches.get(ctx)
  if (!slot || slot.entries.length === 0) return

  if (slot.timer) {
    clearTimeout(slot.timer)
    slot.timer = null
  }

  const combinedText = slot.entries.reduce((acc, e) => acc + e.text, '')
  const lastUuid = slot.entries[slot.entries.length - 1].uuid
  slot.entries = []

  if (!combinedText || win.isDestroyed()) return

  // Emit a single combined stream_event carrying all accumulated text
  win.webContents.send('agent:event', {
    context: ctx,
    type: 'stream_event',
    uuid: lastUuid,
    event: {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: combinedText },
    },
  })
}

export function isTextDeltaEvent(rawMessage: Record<string, unknown>): string | null {
  if (rawMessage.type !== 'stream_event') return null
  const event = rawMessage.event as Record<string, unknown> | undefined
  if (event?.type !== 'content_block_delta') return null
  const delta = event.delta as Record<string, unknown> | undefined
  if (delta?.type !== 'text_delta') return null
  return (delta.text as string) || ''
}

export function scheduleTextBatch(ctx: AgentContext, text: string, uuid: string, win: BrowserWindow): void {
  const slot = ensureBatchSlot(ctx)
  slot.entries.push({ context: ctx, text, uuid })

  if (!slot.timer) {
    slot.timer = setTimeout(() => flushTextBatch(ctx, win), 30)
  }
}

/** Flush any pending text batch for the given context (called during cleanup/abort) */
export function discardTextBatch(ctx: AgentContext): void {
  const slot = textBatches.get(ctx)
  if (slot) {
    if (slot.timer) clearTimeout(slot.timer)
    slot.timer = null
    slot.entries = []
  }
}

/** Discard pending text batches for all contexts (called on window destroy) */
export function discardAllTextBatches(): void {
  for (const ctx of textBatches.keys()) {
    discardTextBatch(ctx)
  }
}
