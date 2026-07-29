import type {
  SDKMessage,
  SDKAssistantMessage,
  SDKUserMessage,
  SDKUserMessageReplay,
  SDKResultMessage,
  SDKResultSuccess,
  SDKResultError,
  SDKPartialAssistantMessage,
} from '@anthropic-ai/claude-agent-sdk'
import type { AgentIPCMessage, StreamEventPayload } from '../shared/types'

// ─── All system-subtype messages the SDK can emit ───────────────────────

type SDKSystemMessageAny = Extract<SDKMessage, { type: 'system' }>

/**
 * Narrow a system message to a specific subtype.
 * This is a type-safe alternative to `as` casts — after the caller has
 * checked `message.subtype === S`, the returned type is the matching SDK type.
 */
function narrowSystem<T extends SDKSystemMessageAny['subtype']>(
  message: SDKSystemMessageAny,
  _subtype: T,
): Extract<SDKSystemMessageAny, { subtype: T }> {
  return message as Extract<SDKSystemMessageAny, { subtype: T }>
}

// ─── Main converter ─────────────────────────────────────────────────────

/**
 * Convert an SDK message into a typed AgentIPCMessage for the renderer.
 * Unknown/irrelevant message types return null and are silently dropped.
 *
 * Uses TypeScript discriminated-union narrowing (switch on message.type / message.subtype)
 * instead of `Record<string, unknown>` + `as` casts.
 */
export function toAgentIPCMessage(message: SDKMessage): AgentIPCMessage | null {
  switch (message.type) {
    case 'assistant':
      return convertAssistant(message)

    case 'user':
      return convertUser(message)

    case 'result':
      return convertResult(message)

    case 'stream_event':
      return convertStreamEvent(message)

    case 'system':
      return convertSystem(message)

    // All other top-level types are not projected to the renderer.
    default:
      return null
  }
}

// ─── System subtypes ────────────────────────────────────────────────────

function convertSystem(message: SDKSystemMessageAny): AgentIPCMessage | null {
  switch (message.subtype) {
    case 'init': {
      const m = narrowSystem(message, 'init')
      return {
        type: 'system',
        subtype: 'init',
        session_id: m.session_id,
      }
    }

    case 'status': {
      const m = narrowSystem(message, 'status')
      const status = m.status
      return {
        type: 'system',
        subtype: 'status',
        status: status === 'compacting' || status === 'requesting' ? status : null,
        compact_result: m.compact_result,
        compact_error: m.compact_error,
      }
    }

    case 'compact_boundary': {
      const m = narrowSystem(message, 'compact_boundary')
      const meta = m.compact_metadata
      return {
        type: 'system',
        subtype: 'compact_boundary',
        compact_metadata: meta ? {
          trigger: meta.trigger,
          pre_tokens: meta.pre_tokens,
          post_tokens: meta.post_tokens,
          duration_ms: meta.duration_ms,
        } : undefined,
      }
    }

    case 'permission_denied': {
      const m = narrowSystem(message, 'permission_denied')
      return {
        type: 'system',
        subtype: 'permission_denied',
        tool_use_id: m.tool_use_id,
        message: m.message,
      }
    }

    // Drop other system subtypes (notification, tool_use_summary, hook_*, etc.)
    default:
      return null
  }
}

// ─── Assistant ──────────────────────────────────────────────────────────

function convertAssistant(message: SDKAssistantMessage): AgentIPCMessage | null {
  const content = message.message?.content
  if (!content || (Array.isArray(content) && content.length === 0)) return null
  return {
    type: 'assistant',
    uuid: message.uuid,
    message: { content: adaptContentBlocks(content) },
    error: message.error,
  }
}

// ─── User ───────────────────────────────────────────────────────────────

function convertUser(message: SDKUserMessage | SDKUserMessageReplay): AgentIPCMessage | null {
  const content = message.message?.content
  if (!content || (Array.isArray(content) && content.length === 0)) return null
  return {
    type: 'user',
    uuid: message.uuid ?? '',
    // Preserve isMeta flag so the renderer can distinguish SDK-injected
    // context messages (skill prompts, etc.) from real user messages.
    ...((message as any).isMeta === true ? { isMeta: true as const } : {}),
    message: { content: adaptContentBlocks(content) },
  }
}

// ─── Result ─────────────────────────────────────────────────────────────

function convertResult(message: SDKResultMessage): AgentIPCMessage {
  return message.subtype === 'success'
    ? convertResultSuccess(message)
    : convertResultError(message)
}

function convertResultSuccess(message: SDKResultSuccess): AgentIPCMessage {
  return {
    type: 'result',
    subtype: 'success',
    session_id: message.session_id,
    stop_reason: message.stop_reason ?? undefined,
  }
}

function convertResultError(message: SDKResultError): AgentIPCMessage {
  return {
    type: 'result',
    subtype: message.subtype,
    session_id: message.session_id,
    errors: message.errors,
  }
}

// ─── Stream Event ───────────────────────────────────────────────────────

function convertStreamEvent(message: SDKPartialAssistantMessage): AgentIPCMessage | null {
  const event = message.event
  if (!event) return null

  const adapted = adaptStreamEvent(event, message.ttft_ms)
  if (!adapted) return null

  return {
    type: 'stream_event',
    uuid: message.uuid,
    event: adapted,
  }
}

/**
 * Adapt an SDK stream event (BetaRawMessageStreamEvent) to our IPC-friendly
 * StreamEventPayload. Returns null for event types we don't forward.
 *
 * ttft_ms lives on the parent SDKPartialAssistantMessage, not inside the event
 * itself — it's passed down from convertStreamEvent so message_start can carry it.
 *
 * message_start is forwarded when ttft_ms is present (latency display).
 */
function adaptStreamEvent(event: { type: string }, ttftMs?: number): StreamEventPayload | null {
  switch (event.type) {
    // Forwarded: content events carry the actual text/tool-use deltas
    case 'content_block_start':
    case 'content_block_delta':
    case 'content_block_stop':
      return event as StreamEventPayload

    // Forward message_start only when ttft_ms is present — useful for latency display
    case 'message_start': {
      if (ttftMs != null) {
        return { type: 'message_start', ttft_ms: ttftMs } as StreamEventPayload
      }
      return null
    }

    default:
      return null
  }
}

// ─── Adaptation helpers ─────────────────────────────────────────────────

/**
 * The SDK's BetaMessage.content is `string | ContentBlockParam[]` where
 * ContentBlockParam is the Anthropic API type. Our IPC type uses a simplified
 * ContentBlock union. At the IPC boundary the shape is structurally compatible
 * for the fields the renderer reads; the cast acknowledges this intentional
 * boundary simplification.
 */
function adaptContentBlocks(content: unknown): any {
  return content
}
