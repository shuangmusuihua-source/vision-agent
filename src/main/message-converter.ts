import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import type { AgentIPCMessage } from '../shared/types'

// Valid result error subtypes from the SDK
const RESULT_ERROR_SUBTYPES = [
  'error_during_execution',
  'error_max_turns',
  'error_max_budget_usd',
  'error_max_structured_output_retries',
] as const

/**
 * Convert an SDK message into a typed AgentIPCMessage for the renderer.
 * Unknown/irrelevant message types return null and are silently dropped.
 */
export function toAgentIPCMessage(message: SDKMessage): AgentIPCMessage | null {
  const msg = message as Record<string, unknown>
  const type = (msg.type as string) || ''
  const subtype = (msg.subtype as string) || ''

  switch (type) {
    case 'system': {
      if (subtype === 'init') {
        return {
          type: 'system',
          subtype: 'init',
          session_id: (msg.session_id as string) || '',
          model: (msg.model as string) || '',
          tools: (msg.tools as string[]) || [],
        }
      }
      if (subtype === 'status') {
        const status = msg.status as string | null
        return {
          type: 'system',
          subtype: 'status',
          status: status === 'compacting' || status === 'requesting' ? status : null,
          compact_result: (msg.compact_result as 'success' | 'failed') || undefined,
          compact_error: (msg.compact_error as string) || undefined,
        }
      }
      if (subtype === 'compact_boundary') {
        const rawMeta = msg.compact_metadata as Record<string, unknown> | undefined
        return {
          type: 'system',
          subtype: 'compact_boundary',
          compact_metadata: rawMeta ? {
            trigger: (rawMeta.trigger as 'manual' | 'auto') || 'auto',
            pre_tokens: (rawMeta.pre_tokens as number) || 0,
            post_tokens: rawMeta.post_tokens as number | undefined,
            duration_ms: rawMeta.duration_ms as number | undefined,
          } : undefined,
        }
      }
      if (subtype === 'permission_denied') {
        return {
          type: 'system',
          subtype: 'permission_denied',
          tool_use_id: (msg.tool_use_id as string) || '',
          message: (msg.message as string) || '',
        }
      }
      if (subtype === 'task_notification') {
        return {
          type: 'system',
          subtype: 'task_notification',
          task_id: (msg.task_id as string) || '',
          status: (msg.status as 'completed' | 'failed' | 'stopped') || 'completed',
          summary: (msg.summary as string) || '',
        }
      }
      // Drop other system subtypes (notification, tool_use_summary, hook_*, etc.)
      return null
    }

    case 'assistant': {
      const apiMessage = msg.message as Record<string, unknown> | undefined
      const content = apiMessage?.content as Array<Record<string, unknown>> | undefined
      if (!content) return null
      return {
        type: 'assistant',
        uuid: (msg.uuid as string) || '',
        message: { content: content as any },
        error: (msg.error as string) || undefined,
      }
    }

    case 'user': {
      const apiMessage = msg.message as Record<string, unknown> | undefined
      const content = apiMessage?.content as Array<Record<string, unknown>> | undefined
      if (!content) return null
      return {
        type: 'user',
        uuid: (msg.uuid as string) || '',
        message: { content: content as any },
      }
    }

    case 'result': {
      const usage = msg.usage as Record<string, unknown> | undefined
      const sessionId = (msg.session_id as string) || undefined
      const stopReason = (msg.stop_reason as string) || undefined
      const numTurns = msg.num_turns as number | undefined
      if (subtype === 'success') {
        return {
          type: 'result',
          subtype: 'success',
          session_id: sessionId,
          usage: {
            input_tokens: (usage?.input_tokens as number) || 0,
            output_tokens: (usage?.output_tokens as number) || 0,
            cache_read_tokens: (usage?.cache_read_input_tokens as number) || 0,
            cache_creation_tokens: (usage?.cache_creation_input_tokens as number) || 0,
          },
          total_cost_usd: (msg.total_cost_usd as number) || 0,
          duration_ms: (msg.duration_ms as number) || 0,
          stop_reason: stopReason,
          num_turns: numTurns,
          result: (msg.result as string) || undefined,
        }
      }
      // Error result variants — preserve specific subtypes
      const errors = (msg.errors as string[]) || []
      const errorSubtype = RESULT_ERROR_SUBTYPES.includes(subtype as any)
        ? (subtype as typeof RESULT_ERROR_SUBTYPES[number])
        : 'error_during_execution'
      return {
        type: 'result',
        subtype: errorSubtype,
        session_id: sessionId,
        errors,
        usage: {
          input_tokens: (usage?.input_tokens as number) || 0,
          output_tokens: (usage?.output_tokens as number) || 0,
          cache_read_tokens: (usage?.cache_read_input_tokens as number) || 0,
          cache_creation_tokens: (usage?.cache_creation_input_tokens as number) || 0,
        },
        total_cost_usd: (msg.total_cost_usd as number) || 0,
        duration_ms: (msg.duration_ms as number) || 0,
        stop_reason: stopReason,
        num_turns: numTurns,
      }
    }

    case 'stream_event': {
      const event = msg.event as Record<string, unknown> | undefined
      if (!event) return null
      const eventType = (event.type as string) || ''

      // Forward content-related events (text, tool_use, thinking/comment)
      if (
        eventType === 'content_block_start' ||
        eventType === 'content_block_delta' ||
        eventType === 'content_block_stop'
      ) {
        return {
          type: 'stream_event',
          uuid: (msg.uuid as string) || '',
          event: event as any,
        }
      }
      // Structural events
      if (
        eventType === 'message_start' ||
        eventType === 'message_delta' ||
        eventType === 'message_stop'
      ) {
        return {
          type: 'stream_event',
          uuid: (msg.uuid as string) || '',
          event: event as any,
        }
      }
      return null
    }

    case 'rate_limit_event': {
      const info = msg.rate_limit_info as Record<string, unknown> | undefined
      return {
        type: 'rate_limit_event',
        rate_limit_info: info ? {
          status: info.status as 'allowed' | 'allowed_warning' | 'rejected' | undefined,
          resets_at: info.resets_at as string | undefined,
          limit: info.limit as number | undefined,
          remaining: info.remaining as number | undefined,
        } : undefined,
      }
    }

    case 'prompt_suggestion': {
      const rawSuggestions = msg.suggestions as Array<Record<string, unknown>> | undefined
      const texts = rawSuggestions
        ? rawSuggestions.map(s => (s.prompt as string) || '').filter(Boolean)
        : []
      return {
        type: 'prompt_suggestion',
        suggestions: texts,
      }
    }

    default:
      return null
  }
}
