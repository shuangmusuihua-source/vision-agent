# TypeScript SDK API Reference

Complete reference for the `@anthropic-ai/claude-agent-sdk` TypeScript package.

## Installation

```bash
npm install @anthropic-ai/claude-agent-sdk
```

## Top-Level Functions

### `query({ prompt, options })`

The primary SDK function. Returns a `Query` object (extends `AsyncGenerator<SDKMessage, void>`).

```typescript
import { query } from '@anthropic-ai/claude-agent-sdk';

const q = query({
  prompt: 'Explain this codebase',
  options: {
    model: 'claude-sonnet-4-20250514',
    permissionMode: 'default',
    cwd: '/path/to/project',
  },
});

for await (const message of q) {
  if (message.type === 'assistant') {
    console.log('Assistant:', message.message.content);
  } else if (message.type === 'result') {
    console.log('Cost:', message.total_cost_usd);
  }
}
```

### `startup({ options, initializeTimeoutMs })`

Pre-initialize the SDK subprocess for faster subsequent queries. Returns `Promise<WarmQuery>`.

```typescript
import { startup } from '@anthropic-ai/claude-agent-sdk';

const warmQuery = await startup({
  options: { model: 'claude-sonnet-4-20250514' },
  initializeTimeoutMs: 30000,
});
```

### `tool(name, description, inputSchema, handler, extras?)`

Define a custom tool. Returns `SdkMcpToolDefinition`.

```typescript
import { tool } from '@anthropic-ai/claude-agent-sdk';

const myTool = tool(
  'search_database',
  'Search the project database for records',
  {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'SQL query or search term' },
      limit: { type: 'number', description: 'Max results to return' },
    },
    required: ['query'],
  },
  async (input) => {
    const results = await db.search(input.query, input.limit);
    return { content: [{ type: 'text', text: JSON.stringify(results) }] };
  },
  {
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
    },
  },
);
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | `string` | Tool name (used in `mcp__{server}__{name}`) |
| `description` | `string` | Tool description shown to the model |
| `inputSchema` | `object` | JSON Schema for tool inputs |
| `handler` | `(input) => Promise<ToolResult>` | Tool execution handler |
| `extras` | `{ annotations?: ToolAnnotations }` | Optional annotations |

### `createSdkMcpServer({ name, version?, tools? })`

Create an in-process MCP server for custom tools. Returns `McpSdkServerConfigWithInstance`.

```typescript
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';

const searchTool = tool('search', 'Search the codebase', { /* schema */ }, async (input) => { /* ... */ });
const lintTool = tool('lint', 'Run the linter', { /* schema */ }, async (input) => { /* ... */ });

const server = createSdkMcpServer({
  name: 'my-tools',
  version: '1.0.0',
  tools: [searchTool, lintTool],
});
```

**Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `name` | `string` | — | Server name (used in tool prefix) |
| `version` | `string?` | `'1.0.0'` | Server version |
| `tools` | `SdkMcpToolDefinition[]?` | `[]` | List of tool definitions |

### `listSessions(options?)`

List all sessions for the current project. Returns `Promise<SDKSessionInfo[]>`.

```typescript
import { listSessions } from '@anthropic-ai/claude-agent-sdk';

const sessions = await listSessions({ cwd: '/path/to/project' });
for (const session of sessions) {
  console.log(session.session_id, session.title, session.last_updated);
}
```

### `getSessionMessages(sessionId, options?)`

Retrieve all messages from a session. Returns `Promise<SessionMessage[]>`.

```typescript
import { getSessionMessages } from '@anthropic-ai/claude-agent-sdk';

const messages = await getSessionMessages('session-123', {
  cwd: '/path/to/project',
});
```

### `getSessionInfo(sessionId, options?)`

Get metadata for a session. Returns `Promise<SDKSessionInfo | undefined>`.

```typescript
import { getSessionInfo } from '@anthropic-ai/claude-agent-sdk';

const info = await getSessionInfo('session-123', { cwd: '/path/to/project' });
if (info) {
  console.log(info.title, info.last_updated);
}
```

### `renameSession(sessionId, title, options?)`

Rename a session. Returns `Promise<void>`.

```typescript
import { renameSession } from '@anthropic-ai/claude-agent-sdk';

await renameSession('session-123', 'Bug fix session', {
  cwd: '/path/to/project',
});
```

### `tagSession(sessionId, tag, options?)`

Tag a session. Returns `Promise<void>`.

```typescript
import { tagSession } from '@anthropic-ai/claude-agent-sdk';

await tagSession('session-123', 'bugfix', { cwd: '/path/to/project' });
```

### `resolveSettings(options?)`

Resolve merged settings from all sources. Returns `Promise<ResolvedSettings>`.

```typescript
import { resolveSettings } from '@anthropic-ai/claude-agent-sdk';

const settings = await resolveSettings({ cwd: '/path/to/project' });
console.log(settings.model, settings.permissionMode);
```

## Options Type

The `options` parameter for `query()` and `startup()` accepts the following fields:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `abortController` | `AbortController?` | — | Controller to abort the query |
| `additionalDirectories` | `string[]?` | `[]` | Additional directories the agent can access |
| `agent` | `string?` | — | Name of a subagent to use |
| `agents` | `AgentDefinition[]?` | `[]` | Subagent definitions |
| `allowedTools` | `string[]?` | — | Tools to auto-approve |
| `disallowedTools` | `string[]?` | — | Tools to deny or remove |
| `canUseTool` | `CanUseToolCallback?` | — | Custom permission callback |
| `continue` | `boolean?` | `false` | Resume most recent session |
| `cwd` | `string?` | `process.cwd()` | Working directory |
| `debug` | `boolean?` | `false` | Enable debug logging |
| `effort` | `'low' \| 'medium' \| 'high'?` | — | Reasoning effort level |
| `enableFileCheckpointing` | `boolean?` | `false` | Enable file change tracking |
| `env` | `Record<string, string>?` | `{}` | Environment variables for agent |
| `forkSession` | `boolean?` | `false` | Fork from resumed session |
| `hooks` | `HookConfig?` | — | Hook configurations |
| `includePartialMessages` | `boolean?` | `false` | Enable streaming partial messages |
| `maxBudgetUsd` | `number?` | — | Maximum budget in USD |
| `maxTurns` | `number?` | — | Maximum agentic turns |
| `mcpServers` | `Record<string, McpServerConfig>?` | `{}` | MCP server configurations |
| `model` | `string?` | `'claude-sonnet-4-20250514'` | Model to use |
| `permissionMode` | `PermissionMode?` | `'default'` | Permission handling mode |
| `persistSession` | `boolean?` | `true` | Persist session to disk (TS only) |
| `plugins` | `PluginConfig[]?` | `[]` | Plugin configurations |
| `resume` | `string?` | — | Session ID to resume |
| `sessionId` | `string?` | — | Custom session ID |
| `sessionStore` | `SessionStore?` | — | Custom session storage adapter |
| `settingSources` | `SettingSource[]?` | — | Settings sources to load |
| `skills` | `'all' \| string[]?` | — | Skills to enable |
| `systemPrompt` | `string?` | — | Custom system prompt |
| `tools` | `SdkMcpToolDefinition[]?` | `[]` | Custom tool definitions (shorthand) |
| `outputFormat` | `'text' \| 'json' \| 'stream-json'?` | `'stream-json'` | Output format |
| `toolConfig` | `ToolConfig?` | — | Tool-specific configuration |
| `toolAliases` | `Record<string, string>?` | — | Tool name aliases |
| `title` | `string?` | — | Session title |
| `taskBudget` | `number?` | — | Token budget per task |
| `thinking` | `ThinkingConfig?` | — | Extended thinking configuration |
| `promptSuggestions` | `string[]?` | — | Suggested prompts for the user |
| `planModeInstructions` | `string?` | — | Instructions for plan mode |
| `agentProgressSummaries` | `boolean?` | — | Enable agent progress summaries |

## Query Object Methods

The `Query` object returned by `query()` has these methods:

### Control Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `interrupt()` | `() => void` | Interrupt the current agent turn |
| `rewindFiles()` | `(checkpointId: string, options?: { dryRun?: boolean }) => Promise<RewindResult>` | Revert files to a checkpoint |
| `setPermissionMode()` | `(mode: PermissionMode) => void` | Change permission mode mid-session |
| `setModel()` | `(model: string) => void` | Change model mid-session |
| `applyFlagSettings()` | `(settings: FlagSettings) => void` | Apply flag-based settings |
| `streamInput()` | `(input: string) => void` | Send additional input to the agent |
| `stopTask()` | `() => void` | Stop the current task |
| `close()` | `() => Promise<void>` | Close the query and clean up resources |

### Information Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `initializationResult()` | `() => InitializationResult` | Get the initialization result |
| `supportedCommands()` | `() => string[]` | List supported slash commands |
| `supportedModels()` | `() => string[]` | List supported models |
| `supportedAgents()` | `() => string[]` | List supported subagents |
| `mcpServerStatus()` | `() => McpServerStatus[]` | Get MCP server connection status |
| `accountInfo()` | `() => AccountInfo` | Get account information |

### MCP Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `reconnectMcpServer()` | `(name: string) => Promise<void>` | Reconnect to an MCP server |
| `toggleMcpServer()` | `(name: string, enabled: boolean) => void` | Enable/disable an MCP server |
| `setMcpServers()` | `(servers: Record<string, McpServerConfig>) => void` | Update MCP server configuration |

## SDKMessage Types

The `SDKMessage` union type includes the following message types:

### Core Message Types

| Type | Description |
|------|-------------|
| `SDKAssistantMessage` | Full assistant response with content and usage |
| `SDKUserMessage` | User message (prompt or tool result) |
| `SDKUserMessageReplay` | Replayed user message from resumed session |
| `SDKResultMessage` | Final result with cost and session info |
| `SDKSystemMessage` | System-level messages (init, config changes) |
| `SDKPartialAssistantMessage` | Partial/streaming assistant message |

### Boundary & Status Messages

| Type | Description |
|------|-------------|
| `SDKCompactBoundaryMessage` | Context compaction boundary marker |
| `SDKStatusMessage` | Agent status updates |
| `SDKLocalCommandOutputMessage` | Output from local commands |

### Hook Messages

| Type | Description |
|------|-------------|
| `SDKHookStartedMessage` | Hook execution started |
| `SDKHookProgressMessage` | Hook execution progress |
| `SDKHookResponseMessage` | Hook execution response |

### Plugin & Tool Messages

| Type | Description |
|------|-------------|
| `SDKPluginInstallMessage` | Plugin installation event |
| `SDKToolProgressMessage` | Tool execution progress |
| `SDKToolUseSummaryMessage` | Summary of tool usage |

### Auth & Rate Limiting

| Type | Description |
|------|-------------|
| `SDKAuthStatusMessage` | Authentication status change |
| `SDKRateLimitEvent` | Rate limit event |

### Task & Agent Messages

| Type | Description |
|------|-------------|
| `SDKTaskNotificationMessage` | Task notification |
| `SDKTaskStartedMessage` | Task started |
| `SDKTaskProgressMessage` | Task progress |
| `SDKTaskUpdatedMessage` | Task updated |
| `SDKSessionStateChangedMessage` | Session state changed |
| `SDKCommandsChangedMessage` | Available commands changed |

### Special Messages

| Type | Description |
|------|-------------|
| `SDKNotificationMessage` | System notification |
| `SDKFilesPersistedEvent` | Files were persisted to disk |
| `SDKMemoryRecallMessage` | Memory recall event |
| `SDKElicitationCompleteMessage` | User elicitation completed |
| `SDKPermissionDeniedMessage` | Permission was denied |
| `SDKPromptSuggestionMessage` | Prompt suggestion for user |
| `SDKAPIRetryMessage` | API retry event |
| `SDKMirrorErrorMessage` | Session mirror error |

## Type Definitions

### AgentDefinition

```typescript
interface AgentDefinition {
  description: string;          // Description shown to the parent agent
  prompt: string;               // System prompt for the subagent
  tools?: string[];             // Tools available to subagent
  disallowedTools?: string[];   // Tools denied from subagent
  model?: string;               // Model override
  skills?: 'all' | string[];   // Skills available to subagent
  mcpServers?: Record<string, McpServerConfig>;  // MCP servers for subagent
  initialPrompt?: string;       // Initial prompt when spawned
  maxTurns?: number;            // Maximum turns
  background?: boolean;         // Run in background
  effort?: 'low' | 'medium' | 'high';  // Reasoning effort
  permissionMode?: PermissionMode;      // Permission mode
  memory?: boolean;             // Enable memory
}
```

### CanUseToolCallback

```typescript
type CanUseToolCallback = (
  toolName: string,
  input: Record<string, unknown>,
  options: {
    signal: AbortSignal;
    suggestions: string[];
    blockedPath?: string;
    decisionReason?: string;
    toolUseID: string;
    agentID?: string;
  },
) => Promise<
  | { behavior: 'allow'; updatedInput?: Record<string, unknown>; updatedPermissions?: PermissionUpdate[] }
  | { behavior: 'deny'; message: string; interrupt?: boolean }
>;
```

### HookConfig

```typescript
interface HookConfig {
  PreToolUse?: HookCallbackMatcher[];
  PostToolUse?: HookCallbackMatcher[];
  PostToolUseFailure?: HookCallbackMatcher[];
  PostToolBatch?: HookCallbackMatcher[];
  UserPromptSubmit?: HookCallbackMatcher[];
  MessageDisplay?: HookCallbackMatcher[];
  Stop?: HookCallbackMatcher[];
  SubagentStart?: HookCallbackMatcher[];
  SubagentStop?: HookCallbackMatcher[];
  PreCompact?: HookCallbackMatcher[];
  PermissionRequest?: HookCallbackMatcher[];
  SessionStart?: HookCallbackMatcher[];
  SessionEnd?: HookCallbackMatcher[];
  Notification?: HookCallbackMatcher[];
  Setup?: HookCallbackMatcher[];
  TeammateIdle?: HookCallbackMatcher[];
  TaskCompleted?: HookCallbackMatcher[];
  ConfigChange?: HookCallbackMatcher[];
  WorktreeCreate?: HookCallbackMatcher[];
  WorktreeRemove?: HookCallbackMatcher[];
}
```

### PermissionMode

```typescript
type PermissionMode =
  | 'default'
  | 'dontAsk'
  | 'acceptEdits'
  | 'bypassPermissions'
  | 'plan'
  | 'auto';
```

### ToolAnnotations

```typescript
interface ToolAnnotations {
  readOnlyHint?: boolean;       // Tool only reads, never modifies
  destructiveHint?: boolean;    // Tool may make destructive changes
  idempotentHint?: boolean;     // Repeated calls have same effect
  openWorldHint?: boolean;      // Tool interacts with external systems
}
```

## Related

- [Overview](./01-overview.md)
- [Sessions](./03-sessions.md)
- [Permissions](./05-permissions.md)
- [Custom Tools](./12-custom-tools.md)
