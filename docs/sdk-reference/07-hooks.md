# Hooks System

Hooks allow you to intercept and control the agent's behavior at various lifecycle points. They are the primary mechanism for adding custom logic around tool execution, session management, and agent events.

## Hook Types

| Hook | When It Fires | Use Cases |
|------|--------------|-----------|
| `PreToolUse` | Before a tool executes | Block, modify, or log tool calls |
| `PostToolUse` | After a tool executes successfully | Log, modify output, add context |
| `PostToolUseFailure` | After a tool execution fails | Error handling, logging |
| `PostToolBatch` | After a batch of tool calls completes | Batch logging, state updates |
| `UserPromptSubmit` | When a user prompt is submitted | Input validation, logging |
| `MessageDisplay` | Before a message is displayed | Format, filter, or annotate |
| `Stop` | When the agent stops | Cleanup, logging |
| `SubagentStart` | When a subagent starts | Logging, resource allocation |
| `SubagentStop` | When a subagent stops | Logging, resource cleanup |
| `PreCompact` | Before context compaction | Custom compaction logic |
| `PermissionRequest` | When a permission request is made | Custom permission UI |
| `SessionStart` | When a session starts | Initialization, logging |
| `SessionEnd` | When a session ends | Cleanup, reporting |
| `Notification` | System notifications | Forward to Slack, PagerDuty |
| `Setup` | Agent setup phase | Configuration, validation |
| `TeammateIdle` | When a teammate agent becomes idle | Task redistribution |
| `TaskCompleted` | When a task completes | Status reporting |
| `ConfigChange` | When configuration changes | React to setting updates |
| `WorktreeCreate` | When a git worktree is created | Logging, setup |
| `WorktreeRemove` | When a git worktree is removed | Cleanup |

## HookCallback

Each hook callback is an async function that receives the hook input and returns a hook output:

```typescript
type HookCallback = (
  input: HookInput,
  toolUseID: string,
  context: { signal: AbortSignal },
) => Promise<HookOutput>;
```

### HookInput

The input object varies by hook type, but generally includes:

| Field | Type | Description |
|-------|------|-------------|
| `tool_name` | `string?` | Name of the tool being called (PreToolUse, PostToolUse) |
| `tool_input` | `Record<string, unknown>?` | Tool input parameters |
| `tool_output` | `string?` | Tool output (PostToolUse) |
| `session_id` | `string?` | Current session ID |
| `prompt` | `string?` | User prompt (UserPromptSubmit) |

### HookOutput

Return an object to control behavior:

```typescript
type HookOutput =
  | {}                                                    // Allow, no modifications
  | { hookSpecificOutput: { permissionDecision: 'allow' | 'deny' | 'ask' | 'defer' } }  // Control permission
  | { updatedInput: Record<string, unknown> }             // Modify tool input (PreToolUse)
  | { updatedToolOutput: string }                         // Modify tool output (PostToolUse)
  | { additionalContext: string }                         // Add context (PostToolUse)
  | { async: true; asyncTimeout: number }                 // Async hook with timeout
```

## HookCallbackMatcher

Hooks are configured using `HookCallbackMatcher` objects, which allow pattern matching on tool names:

```typescript
interface HookCallbackMatcher {
  matcher?: string;      // Pattern to match tool names
  hooks: HookCallback[]; // Callbacks to run
  timeout?: number;      // Timeout in milliseconds
}
```

### Matcher Patterns

| Pattern | Meaning |
|---------|---------|
| Exact tool name | Match only that tool (e.g., `'Bash'`) |
| `Tool1\|Tool2` | Match either tool (pipe separator) |
| `/regex/` | Match using a regular expression |
| `*` or empty/omitted | Match all tools |

### Matcher Examples

```typescript
// Match only the Bash tool
{ matcher: 'Bash', hooks: [bashHook] }

// Match Bash or Write tools
{ matcher: 'Bash|Write', hooks: [destructiveToolHook] }

// Match all tools starting with 'mcp__'
{ matcher: '/^mcp__/', hooks: [mcpToolHook] }

// Match all tools
{ matcher: '*', hooks: [allToolHook] }
{ matcher: '', hooks: [allToolHook] }      // empty string also matches all
{ hooks: [allToolHook] }                    // omitted matcher also matches all
```

## Configuration

Hooks are configured in the `options.hooks` object:

```typescript
import { query } from '@anthropic-ai/claude-agent-sdk';

const q = query({
  prompt: 'Analyze and fix the bugs',
  options: {
    hooks: {
      PreToolUse: [
        {
          matcher: 'Bash|Write',
          hooks: [async (input, toolUseID, ctx) => {
            console.log(`About to use ${input.tool_name} with:`, input.tool_input);
            return {};  // Allow the tool call
          }],
          timeout: 5000,
        },
      ],
      PostToolUse: [
        {
          hooks: [async (input, toolUseID, ctx) => {
            console.log(`Tool ${input.tool_name} completed`);
            return {};
          }],
        },
      ],
    },
  },
});
```

## PreToolUse Hook

The `PreToolUse` hook fires before a tool is executed. It can block, modify, or allow the call.

### Block a Tool Call

Return a `permissionDecision: 'deny'` to block the tool call:

```typescript
PreToolUse: [
  {
    matcher: 'Bash',
    hooks: [async (input, toolUseID, ctx) => {
      const command = input.tool_input?.command as string;
      if (command?.includes('rm -rf')) {
        return {
          hookSpecificOutput: {
            permissionDecision: 'deny',
          },
        };
      }
      return {};  // Allow other Bash commands
    }],
  },
],
```

### Modify Tool Input

Return `updatedInput` to change the tool's input parameters:

```typescript
PreToolUse: [
  {
    matcher: 'Bash',
    hooks: [async (input, toolUseID, ctx) => {
      const command = input.tool_input?.command as string;
      // Add --dry-run to all npm install commands
      if (command?.includes('npm install')) {
        return {
          updatedInput: {
            ...input.tool_input,
            command: command + ' --dry-run',
          },
        };
      }
      return {};
    }],
  },
],
```

### Defer to Permission Mode

Return `permissionDecision: 'ask'` to let the normal permission flow handle it:

```typescript
PreToolUse: [
  {
    matcher: 'Edit',
    hooks: [async (input, toolUseID, ctx) => {
      const filePath = input.tool_input?.file_path as string;
      if (filePath?.startsWith('/etc/')) {
        return {
          hookSpecificOutput: {
            permissionDecision: 'ask',
          },
        };
      }
      return {};  // Auto-allow edits outside /etc/
    }],
  },
],
```

## PostToolUse Hook

The `PostToolUse` hook fires after a tool executes successfully.

### Add Additional Context

Return `additionalContext` to add information to the conversation:

```typescript
PostToolUse: [
  {
    matcher: 'Bash',
    hooks: [async (input, toolUseID, ctx) => {
      const command = input.tool_input?.command as string;
      if (command?.includes('npm test')) {
        return {
          additionalContext: 'Note: Test results may be flaky. Consider running again if failures occur.',
        };
      }
      return {};
    }],
  },
],
```

### Modify Tool Output

Return `updatedToolOutput` to change the tool's output:

```typescript
PostToolUse: [
  {
    matcher: 'Read',
    hooks: [async (input, toolUseID, ctx) => {
      // Redact sensitive information from file reads
      const output = input.tool_output as string;
      const redacted = output.replace(/API_KEY=.*/g, 'API_KEY=[REDACTED]');
      return { updatedToolOutput: redacted };
    }],
  },
],
```

## Notification Hook

The `Notification` hook is useful for forwarding events to external systems:

```typescript
Notification: [
  {
    hooks: [async (input, toolUseID, ctx) => {
      // Forward to Slack
      await fetch('https://hooks.slack.com/services/XXX', {
        method: 'POST',
        body: JSON.stringify({
          text: `Claude Agent: ${input.message}`,
        }),
      });
      return {};
    }],
  },
],
```

## Async Hooks

For long-running hook operations, use the async output pattern:

```typescript
PreToolUse: [
  {
    matcher: 'Bash',
    hooks: [async (input, toolUseID, ctx) => {
      // Start an async validation process
      validateAsync(input.tool_input);
      return {
        async: true,
        asyncTimeout: 30000,  // Wait up to 30 seconds
      };
    }],
  },
],
```

## Hook Timeout

Set a `timeout` on the `HookCallbackMatcher` to limit how long hooks can run:

```typescript
PreToolUse: [
  {
    matcher: 'Bash',
    hooks: [async (input, toolUseID, ctx) => {
      // This hook has 5 seconds to complete
      await someAsyncOperation();
      return {};
    }],
    timeout: 5000,  // 5 second timeout
  },
],
```

## Complete Example: Audit Logging

```typescript
import { query } from '@anthropic-ai/claude-agent-sdk';

const auditLog: Array<{ timestamp: string; event: string; details: unknown }> = [];

const q = query({
  prompt: 'Fix the security vulnerabilities',
  options: {
    hooks: {
      SessionStart: [{
        hooks: [async (input, toolUseID, ctx) => {
          auditLog.push({ timestamp: new Date().toISOString(), event: 'session_start', details: input });
          return {};
        }],
      }],

      PreToolUse: [{
        matcher: 'Bash|Write|Edit',
        hooks: [async (input, toolUseID, ctx) => {
          auditLog.push({
            timestamp: new Date().toISOString(),
            event: `pre_${input.tool_name}`,
            details: input.tool_input,
          });
          // Block dangerous commands
          if (input.tool_name === 'Bash') {
            const cmd = input.tool_input?.command as string;
            if (cmd?.match(/rm\s+-rf\s+\//)) {
              return {
                hookSpecificOutput: { permissionDecision: 'deny' },
              };
            }
          }
          return {};
        }],
      }],

      PostToolUse: [{
        hooks: [async (input, toolUseID, ctx) => {
          auditLog.push({
            timestamp: new Date().toISOString(),
            event: `post_${input.tool_name}`,
            details: { output: (input.tool_output as string)?.substring(0, 200) },
          });
          return {};
        }],
      }],

      SessionEnd: [{
        hooks: [async (input, toolUseID, ctx) => {
          auditLog.push({ timestamp: new Date().toISOString(), event: 'session_end', details: input });
          // Write audit log to file
          const fs = await import('fs/promises');
          await fs.writeFile('audit-log.json', JSON.stringify(auditLog, null, 2));
          return {};
        }],
      }],
    },
  },
});

for await (const message of q) {
  if (message.type === 'result') {
    console.log('Session complete. Audit log written.');
  }
}
```

## Related

- [Overview](./01-overview.md)
- [TypeScript API](./02-typescript-api.md)
- [Permissions](./05-permissions.md)
- [User Input](./06-user-input.md)
