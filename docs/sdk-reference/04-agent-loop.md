# Agent Loop Internals

Understanding how the agent loop works internally helps you configure and debug agent behavior effectively.

## Agent Loop Overview

The agent loop is the core execution cycle that drives Claude's agentic behavior. Each iteration consists of:

1. **Prompt construction** — Assemble the system prompt, conversation history, and tool definitions
2. **API call** — Send the request to the Claude API
3. **Response processing** — Parse the response for text content and tool use requests
4. **Tool execution** — Execute requested tools (subject to permission checks)
5. **Result injection** — Feed tool results back into the conversation
6. **Loop or stop** — If the model requests more tool use, loop; otherwise, emit a `ResultMessage`

## Turn Structure

A single "turn" in the agent loop produces:

```
User Message → API Call → Assistant Message → Tool Use → Tool Results → (next turn)
```

### Turn Limits

Control the maximum number of agentic turns with `maxTurns`:

```typescript
const q = query({
  prompt: 'Refactor the module',
  options: {
    maxTurns: 10,  // Stop after 10 agentic turns
  },
});
```

When `maxTurns` is reached, the agent stops and emits a `ResultMessage` with `stop_reason: 'max_turns'`.

### Budget Limits

Control the maximum cost with `maxBudgetUsd`:

```typescript
const q = query({
  prompt: 'Analyze the codebase',
  options: {
    maxBudgetUsd: 1.00,  // Stop when cost exceeds $1.00
  },
});
```

### Token Budget per Task

Use `taskBudget` to set a per-task token budget:

```typescript
const q = query({
  prompt: 'Work on the project',
  options: {
    taskBudget: 100000,  // 100k tokens per task
  },
});
```

## Message Flow

### Message Types in Order

During a typical agent loop, messages are yielded in this order:

```
SDKSystemMessage (init)           — Session initialization
SDKStatusMessage                  — Agent status updates
  SDKAssistantMessage             — Full assistant response
    SDKToolProgressMessage        — (if tools are used) Progress updates
  SDKUserMessage                  — Tool results fed back
  ... (repeat for each turn)
SDKResultMessage                  — Final result
```

### With Partial Messages

When `includePartialMessages: true`, streaming events are interleaved:

```
SDKSystemMessage (init)
SDKPartialAssistantMessage        — Streaming text deltas
SDKPartialAssistantMessage        — More deltas...
SDKAssistantMessage               — Complete assistant message
SDKToolProgressMessage
SDKUserMessage
SDKPartialAssistantMessage        — Next turn streaming
...
SDKResultMessage
```

## Context Management

### Context Window

The agent maintains a conversation history that grows with each turn. When the context approaches the model's limit, the SDK performs **context compaction**.

### Compaction

When context compaction occurs:

1. A `SDKCompactBoundaryMessage` is emitted
2. The conversation history is summarized
3. The agent continues with the compacted context

The `PreCompact` hook allows you to intercept before compaction:

```typescript
const q = query({
  prompt: 'Long-running analysis',
  options: {
    hooks: {
      PreCompact: [{
        hooks: [async (input) => {
          console.log('Context is being compacted');
          return {};
        }],
      }],
    },
  },
});
```

## Tool Execution Flow

### Permission Evaluation

Before each tool execution, permissions are evaluated in this order:

1. **Hooks** — `PreToolUse` hooks can block or modify the call
2. **Deny rules** — `disallowedTools` with bare names remove the tool; scoped rules deny matching calls
3. **Ask rules** — Permission mode determines whether to ask
4. **Permission mode** — Controls default behavior for unlisted tools
5. **Allow rules** — `allowedTools` auto-approve listed tools
6. **`canUseTool` callback** — Custom programmatic permission check

See [05-permissions.md](./05-permissions.md) for full details.

### Tool Batching

The model may request multiple tool calls in a single turn. These are executed in parallel when possible. A `PostToolBatch` hook fires after all tools in a batch complete.

### Tool Progress

Long-running tools emit `SDKToolProgressMessage` events with progress information. These can be used to display progress indicators.

## Interruption

### Programmatic Interruption

Call `interrupt()` on the query object to interrupt the current turn:

```typescript
const q = query({
  prompt: 'Long-running task',
  options: {},
});

setTimeout(() => {
  q.interrupt();
  console.log('Interrupted after 30 seconds');
}, 30000);

for await (const message of q) {
  // Process messages
}
```

### Abort Controller

Use an `AbortController` to abort the entire query:

```typescript
const controller = new AbortController();

const q = query({
  prompt: 'Analyze the codebase',
  options: {
    abortController: controller,
  },
});

// Abort after 60 seconds
setTimeout(() => controller.abort(), 60000);
```

## Subagent Execution

When the agent uses the `Agent` tool to spawn a subagent:

1. A `SubagentStart` hook fires
2. The subagent runs its own agent loop independently
3. Subagent messages include `parent_tool_use_id` to link them to the parent
4. A `SubagentStop` hook fires when the subagent completes
5. The subagent result is fed back to the parent as a tool result

Subagents cannot spawn their own subagents (single level of nesting).

See [09-subagents.md](./09-subagents.md) for full details.

## Stop Conditions

The agent loop stops when any of these conditions are met:

| Condition | Description |
|-----------|-------------|
| Model stops | The model ends without requesting tool use |
| `maxTurns` reached | Turn limit exceeded |
| `maxBudgetUsd` exceeded | Budget limit exceeded |
| `interrupt()` called | Programmatic interruption |
| `AbortController.abort()` | Query aborted |
| Permission denied | A tool call is denied with `interrupt: true` |
| Fatal error | Unrecoverable error occurs |

## Status Messages

`SDKStatusMessage` types indicate the agent's current state:

| Status | Description |
|--------|-------------|
| `thinking` | Agent is processing (API call in progress) |
| `tool_use` | Agent is executing a tool |
| `waiting_for_permission` | Waiting for user approval |
| `compacting` | Context compaction in progress |

## Related

- [Overview](./01-overview.md)
- [TypeScript API](./02-typescript-api.md)
- [Permissions](./05-permissions.md)
- [Hooks](./07-hooks.md)
- [Streaming Output](./11-streaming-output.md)
- [Subagents](./09-subagents.md)
