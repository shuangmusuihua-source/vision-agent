import type {
  SDKMessage,
  SDKAssistantMessage,
  SDKUserMessage,
  SDKUserMessageReplay,
  SDKResultMessage,
  SDKResultSuccess,
  SDKResultError,
  SDKSystemMessage,
  SDKStatusMessage,
  SDKCompactBoundaryMessage,
  SDKPermissionDeniedMessage,
  SDKPartialAssistantMessage,
  SDKRateLimitEvent,
  SDKPromptSuggestionMessage,
} from '@anthropic-ai/claude-agent-sdk'
import type { AgentIPCMessage, StreamEventPayload, UsageInfo } from '../shared/types'

// ─── All system-subtype messages the SDK can emit ───────────────────────

type SDKSystemMessageAny = Extract<SDKMessage, { type: 'system' }>

/**
 * Narrow a system message to a specific subtype.
 * This is a type-safe alternative to `as` casts — after the caller has
 * checked `message.subtype === S`, the returned type is the matching SDK type.
 */
function narrowSystem<T extends SDKSystemMessageAny['subtype']>(
  message: SDKSystemMessageAny,
  subtype: T,
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

    // All other top-level types (auth_status, tool_progress, tool_use_summary,
    // prompt_suggestion, rate_limit_event, etc.) — handle those with SDK types.
    default: {
      if (message.type === 'rate_limit_event') {
        return convertRateLimitEvent(message as SDKRateLimitEvent)
      }
      if (message.type === 'prompt_suggestion') {
        return convertPromptSuggestion(message as SDKPromptSuggestionMessage)
      }
      return null
    }
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
        model: m.model,
        tools: m.tools,
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

    case 'task_notification': {
      const m = narrowSystem(message, 'task_notification')
      return {
        type: 'system',
        subtype: 'task_notification',
        task_id: m.task_id,
        status: m.status,
        summary: m.summary,
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
  const usage = extractUsage(message.usage)
  return message.subtype === 'success'
    ? convertResultSuccess(message, usage)
    : convertResultError(message, usage)
}

function convertResultSuccess(message: SDKResultSuccess, usage: UsageInfo): AgentIPCMessage {
  return {
    type: 'result',
    subtype: 'success',
    session_id: message.session_id,
    usage,
    total_cost_usd: message.total_cost_usd,
    duration_ms: message.duration_ms,
    stop_reason: message.stop_reason ?? undefined,
    num_turns: message.num_turns,
    result: message.result,
  }
}

function convertResultError(message: SDKResultError, usage: UsageInfo): AgentIPCMessage {
  return {
    type: 'result',
    subtype: message.subtype,
    session_id: message.session_id,
    errors: message.errors,
    usage,
    total_cost_usd: message.total_cost_usd,
    duration_ms: message.duration_ms,
    stop_reason: message.stop_reason ?? undefined,
    num_turns: message.num_turns,
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
 * message_delta / message_stop are still filtered — the renderer has no use
 * for them yet and forwarding them is pure overhead.
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

    // Filtered: message_delta and message_stop are unused by the renderer
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

// ─── Usage extraction ───────────────────────────────────────────────────

function extractUsage(usage: NonNullable<SDKResultMessage['usage']>): UsageInfo {
  return {
    input_tokens: usage.input_tokens ?? 0,
    output_tokens: usage.output_tokens ?? 0,
    cache_read_tokens: usage.cache_read_input_tokens ?? 0,
    cache_creation_tokens: usage.cache_creation_input_tokens ?? 0,
  }
}

// ─── Rate limit & prompt suggestion (typed via SDK) ─────────────────────

function convertRateLimitEvent(message: SDKRateLimitEvent): AgentIPCMessage {
  const info = message.rate_limit_info
  return {
    type: 'rate_limit_event',
    rate_limit_info: {
      status: info.status,
      resets_at: info.resetsAt ? new Date(info.resetsAt).toISOString() : undefined,
      limit: undefined, // SDK uses utilization instead of limit/remaining
      remaining: undefined,
    },
  }
}

function convertPromptSuggestion(message: SDKPromptSuggestionMessage): AgentIPCMessage {
  return {
    type: 'prompt_suggestion',
    suggestions: [message.suggestion].filter(Boolean),
  }
}
