# Streaming Output

The SDK supports streaming partial messages, allowing you to display agent output in real-time as it is generated.

## Enabling Streaming

Set `includePartialMessages: true` in the query options to enable streaming:

```typescript
import { query } from '@anthropic-ai/claude-agent-sdk';

const q = query({
  prompt: 'Explain the authentication system',
  options: {
    includePartialMessages: true,
  },
});

for await (const message of q) {
  if (message.type === 'stream_event') {
    // Handle streaming events
    handleStreamEvent(message);
  }
}
```

## StreamEvent Type

When streaming is enabled, `StreamEvent` messages are yielded with the following structure:

```typescript
interface StreamEvent {
  type: 'stream_event';
  event: BetaRawMessageStreamEvent;  // Raw API stream event
  session_id: string;
  uuid: string;
  parent_tool_use_id?: string;       // Present for subagent events
  ttft_ms?: number;                  // Time to first token
}
```

## Stream Event Types

The `event` field contains raw Anthropic API stream events:

| Event | Description |
|-------|-------------|
| `message_start` | A new message has started |
| `content_block_start` | A new content block (text, tool_use) has started |
| `content_block_delta` | Incremental content update |
| `content_block_stop` | Content block completed |
| `message_delta` | Message-level metadata update (stop reason, usage) |
| `message_stop` | Message completed |

## Handling Text Deltas

The most common use case is displaying text as it streams in:

```typescript
for await (const message of q) {
  if (message.type === 'stream_event') {
    const event = message.event;

    // Text delta — incremental text content
    if (
      event.type === 'content_block_delta' &&
      event.delta.type === 'text_delta'
    ) {
      process.stdout.write(event.delta.text);
    }
  }
}
```

### Complete Streaming Example

```typescript
import { query } from '@anthropic-ai/claude-agent-sdk';

const q = query({
  prompt: 'Write a detailed explanation of the project architecture',
  options: {
    includePartialMessages: true,
    model: 'claude-sonnet-4-20250514',
  },
});

let fullText = '';

for await (const message of q) {
  if (message.type === 'stream_event') {
    const event = message.event;

    switch (event.type) {
      case 'message_start':
        console.log('--- Message started ---');
        break;

      case 'content_block_start':
        if (event.content_block.type === 'text') {
          // New text block starting
        } else if (event.content_block.type === 'tool_use') {
          console.log(`\n[Using tool: ${event.content_block.name}]`);
        }
        break;

      case 'content_block_delta':
        if (event.delta.type === 'text_delta') {
          process.stdout.write(event.delta.text);
          fullText += event.delta.text;
        } else if (event.delta.type === 'input_json_delta') {
          // Tool input streaming
          process.stdout.write(event.delta.partial_json);
        }
        break;

      case 'content_block_stop':
        // Content block completed
        break;

      case 'message_delta':
        if (event.delta.stop_reason) {
          console.log(`\n--- Message stopped: ${event.delta.stop_reason} ---`);
        }
        break;

      case 'message_stop':
        console.log('--- Message complete ---');
        break;
    }
  } else if (message.type === 'result') {
    console.log('\nTotal cost:', message.total_cost_usd);
  }
}
```

## Time to First Token (TTFT)

The `ttft_ms` field on `StreamEvent` provides the time to first token measurement:

```typescript
for await (const message of q) {
  if (message.type === 'stream_event' && message.ttft_ms) {
    console.log(`Time to first token: ${message.ttft_ms}ms`);
  }
}
```

This is useful for monitoring performance and latency.

## Subagent Streaming

When subagents are running, their streaming events include `parent_tool_use_id` to identify which parent tool call they belong to:

```typescript
for await (const message of q) {
  if (message.type === 'stream_event') {
    if (message.parent_tool_use_id) {
      // This is a subagent event
      console.log(`[Subagent ${message.parent_tool_use_id}]`, message.event);
    } else {
      // This is a main agent event
      console.log('[Main]', message.event);
    }
  }
}
```

## Streaming with Tool Use

When the agent uses tools during a streaming session, you will see:

1. `content_block_start` with `type: 'tool_use'` — Tool call begins
2. `content_block_delta` with `type: 'input_json_delta'` — Tool input streaming
3. `content_block_stop` — Tool call ends
4. Tool execution happens (may emit `SDKToolProgressMessage`)
5. `SDKUserMessage` with tool result
6. Next assistant message begins streaming

```typescript
for await (const message of q) {
  if (message.type === 'stream_event') {
    const event = message.event;

    if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
      console.log(`\n🔧 Using tool: ${event.content_block.name}`);
    }

    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      process.stdout.write(event.delta.text);
    }
  }

  if (message.type === 'tool_progress') {
    console.log(`  Progress: ${message.progress}`);
  }
}
```

## Mixing Streaming and Non-Streaming Messages

When `includePartialMessages: true`, you still receive all the non-streaming message types:

```typescript
for await (const message of q) {
  switch (message.type) {
    case 'stream_event':
      // Streaming delta
      handleStreamEvent(message.event);
      break;

    case 'assistant':
      // Complete assistant message (after all deltas)
      console.log('Full message received');
      break;

    case 'tool_progress':
      // Tool execution progress
      break;

    case 'result':
      // Final result
      console.log('Cost:', message.total_cost_usd);
      break;

    case 'system':
      // System messages
      break;
  }
}
```

The typical order is:
1. `stream_event` messages (deltas)
2. `assistant` message (complete)
3. `tool_progress` messages (if tools used)
4. `stream_event` messages (next turn deltas)
5. ... repeat ...
6. `result` message (final)

## Performance Considerations

- Streaming adds overhead due to frequent message yields
- For batch processing or non-interactive use cases, disable streaming (`includePartialMessages: false`)
- Text deltas are typically 1-3 tokens each — buffer if needed for display purposes
- Use `ttft_ms` to monitor first-token latency

## Related

- [Overview](./01-overview.md)
- [TypeScript API](./02-typescript-api.md)
- [Agent Loop](./04-agent-loop.md)
- [Subagents](./09-subagents.md)
