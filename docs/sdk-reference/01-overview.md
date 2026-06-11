# Agent SDK Overview

The Claude Agent SDK provides a programmatic interface for running Claude Code as a subprocess. It enables building agentic workflows where Claude can use tools, manage sessions, and interact with your application.

## Core Concepts

### Primary Function: `query()`

The SDK exposes `query()` as the primary entry point. It returns an async generator that yields `SDKMessage` objects as the agent processes the prompt.

```typescript
import { query } from '@anthropic-ai/claude-agent-sdk';

for await (const message of query({ prompt: 'Explain this codebase', options: {} })) {
  console.log(message);
}
```

### Warm Start: `startup()`

Use `startup()` to pre-initialize the SDK subprocess so that subsequent queries start faster. Returns a `WarmQuery` promise.

```typescript
import { startup } from '@anthropic-ai/claude-agent-sdk';

const warmQuery = await startup({
  options: { model: 'claude-sonnet-4-20250514' },
  initializeTimeoutMs: 30000,
});
```

## Built-in Tools

The agent has access to these built-in tools:

| Tool | Description |
|------|-------------|
| `Read` | Read file contents |
| `Write` | Write to files |
| `Edit` | Make targeted edits to existing files |
| `Bash` | Execute shell commands |
| `Glob` | Find files by pattern |
| `Grep` | Search file contents |
| `WebSearch` | Search the web |
| `WebFetch` | Fetch web pages |
| `AskUserQuestion` | Ask the user a question and wait for a response |
| `Agent` | Spawn a subagent |
| `Skill` | Invoke a skill |
| `Monitor` | Monitor a long-running process |
| `ToolSearch` | Search available tools |

## Permission Modes

Permission modes control how the agent handles tool-use approvals:

| Mode | Behavior |
|------|----------|
| `default` | Ask for approval on write/delete operations |
| `dontAsk` | Auto-approve all operations (dangerous) |
| `acceptEdits` | Auto-approve file edits, ask for Bash commands |
| `bypassPermissions` | Skip all permission checks (dangerous) |
| `plan` | Only plan, do not execute write operations |
| `auto` | Automatically decide based on tool type |

```typescript
const q = query({
  prompt: 'Refactor the auth module',
  options: { permissionMode: 'acceptEdits' },
});
```

## Key Features

### Hooks System

Hooks allow you to intercept and control tool execution at various lifecycle points:

- **PreToolUse** — Before a tool executes (can block or modify)
- **PostToolUse** — After a tool executes (can modify output)
- **PostToolUseFailure** — After a tool fails
- **PostToolBatch** — After a batch of tool calls completes
- **UserPromptSubmit** — When a user prompt is submitted
- **MessageDisplay** — When a message is about to be displayed
- **Stop** — When the agent stops
- **SubagentStart** / **SubagentStop** — Subagent lifecycle
- **PreCompact** — Before context compaction
- **PermissionRequest** — When a permission request is made
- **SessionStart** / **SessionEnd** — Session lifecycle
- **Notification** — System notifications
- **Setup** — Agent setup phase
- **TeammateIdle** — When a teammate agent becomes idle
- **TaskCompleted** — When a task completes
- **ConfigChange** — When configuration changes
- **WorktreeCreate** / **WorktreeRemove** — Git worktree operations

See [07-hooks.md](./07-hooks.md) for full details.

### MCP Server Integration

The SDK supports Model Context Protocol (MCP) servers via multiple transports:

| Transport | Description |
|-----------|-------------|
| `stdio` | Standard input/output communication |
| `SSE` | Server-Sent Events |
| `HTTP` | HTTP-based transport |
| `SDK` | In-process SDK server (for custom tools) |

See [08-mcp.md](./08-mcp.md) for full details.

### Subagents

Subagents allow the agent to delegate tasks to specialized child agents defined via `AgentDefinition`. Subagents cannot spawn their own subagents.

See [09-subagents.md](./09-subagents.md) for full details.

### Skills

Skills are filesystem-based capabilities discovered from `.claude/skills/*/SKILL.md` files. They are loaded via `settingSources` and can be selected with the `skills` option.

See [10-skills.md](./10-skills.md) for full details.

### Custom Tools

Custom tools can be registered using `tool()` and `createSdkMcpServer()`, then passed to the agent via the `mcpServers` option.

See [12-custom-tools.md](./12-custom-tools.md) for full details.

### Session Management

Sessions can be continued, resumed, or forked:

- `continue: true` — Resume the most recent session
- `resume: sessionId` — Resume a specific session
- `forkSession: true` — Create a branch from the resumed session

See [03-sessions.md](./03-sessions.md) for full details.

### File Checkpointing

Enable file checkpointing to track and rewind file changes made by the agent:

```typescript
const q = query({
  prompt: 'Refactor the module',
  options: {
    enableFileCheckpointing: true,
    extraArgs: { 'replay-user-messages': null },
  },
});
```

See [13-file-checkpointing.md](./13-file-checkpointing.md) for full details.

### Session Storage

Custom session storage backends via the `SessionStore` adapter interface. Supports S3, Redis, Postgres, and custom implementations.

See [14-session-storage.md](./14-session-storage.md) for full details.

### Cost Tracking

Track token usage and estimated costs via `total_cost_usd` on `ResultMessage`.

See [15-cost-tracking.md](./15-cost-tracking.md) for full details.

## Related

- [TypeScript API Reference](./02-typescript-api.md)
- [Session Management](./03-sessions.md)
- [Permission Configuration](./05-permissions.md)
- [Streaming Output](./11-streaming-output.md)
