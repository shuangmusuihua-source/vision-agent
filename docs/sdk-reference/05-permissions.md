# Permission Configuration

The SDK provides a flexible permission system that controls which tools the agent can use and when it needs to ask for approval.

## Permission Evaluation Order

When a tool call is made, permissions are evaluated in the following order. The first matching rule determines the outcome:

```
1. Hooks (PreToolUse)
   ↓ (if not blocked)
2. Deny rules (disallowedTools)
   ↓ (if not denied)
3. Ask rules (permission mode)
   ↓ (if not auto-approved by mode)
4. Allow rules (allowedTools)
   ↓ (if not auto-approved)
5. canUseTool callback
   ↓ (if not resolved)
Default: Ask the user
```

## Permission Modes

| Mode | Behavior |
|------|----------|
| `default` | Ask for approval on write/delete operations, auto-approve reads |
| `dontAsk` | Auto-approve all operations without prompting. **Dangerous** — use with caution |
| `acceptEdits` | Auto-approve file edits (Write, Edit), ask for Bash commands |
| `bypassPermissions` | Skip all permission checks entirely. **Dangerous** — use only in trusted environments |
| `plan` | Only plan operations, do not execute writes. Ask for any write operations |
| `auto` | Automatically decide based on tool type and context |

```typescript
import { query } from '@anthropic-ai/claude-agent-sdk';

// Safe: ask before destructive operations
const q1 = query({
  prompt: 'Refactor the module',
  options: { permissionMode: 'default' },
});

// Auto-approve file edits, ask for shell commands
const q2 = query({
  prompt: 'Refactor the module',
  options: { permissionMode: 'acceptEdits' },
});

// Full auto-approve (use with extreme caution)
const q3 = query({
  prompt: 'Refactor the module',
  options: { permissionMode: 'bypassPermissions' },
});
```

> **Warning:** `bypassPermissions` and `dontAsk` modes bypass all safety checks. Only use these in fully trusted, sandboxed environments.

## Allowed Tools

The `allowedTools` option specifies tools that should be auto-approved without prompting:

```typescript
const q = query({
  prompt: 'Analyze the codebase',
  options: {
    allowedTools: ['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch'],
  },
});
```

This is commonly used to pre-approve read-only tools:

```typescript
// Pre-approve all read-only tools
allowedTools: ['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch']
```

You can also allow specific MCP tools:

```typescript
allowedTools: ['mcp__myserver__search', 'mcp__myserver__query']
```

## Disallowed Tools

The `disallowedTools` option has two behaviors depending on the format:

### Bare Tool Name (Removal)

A bare tool name **removes** the tool from the agent's context entirely. The agent will not know the tool exists:

```typescript
disallowedTools: ['Bash']  // Agent cannot use Bash at all
```

### Scoped Rule (Denial)

A scoped rule **denies** matching tool calls but the tool still appears in the agent's context:

```typescript
// Deny Write to specific paths
disallowedTools: ['Write:/etc/*', 'Edit:/etc/*']
```

## CanUseTool Callback

The `canUseTool` callback provides programmatic control over tool approvals. It is the last check in the evaluation order.

### Signature

```typescript
type CanUseToolCallback = (
  toolName: string,
  input: Record<string, unknown>,
  options: {
    signal: AbortSignal;           // AbortSignal for cancellation
    suggestions: string[];         // Suggested permission rules
    blockedPath?: string;          // Path that was blocked (if any)
    decisionReason?: string;       // Why this check was triggered
    toolUseID: string;             // Unique ID for this tool use
    agentID?: string;              // ID of the agent (for subagents)
  },
) => Promise<
  | { behavior: 'allow'; updatedInput?: Record<string, unknown>; updatedPermissions?: PermissionUpdate[] }
  | { behavior: 'deny'; message: string; interrupt?: boolean }
>;
```

### Allow a Tool

```typescript
const q = query({
  prompt: 'Analyze and fix bugs',
  options: {
    canUseTool: async (toolName, input, opts) => {
      // Auto-approve all read operations
      if (['Read', 'Glob', 'Grep'].includes(toolName)) {
        return { behavior: 'allow' };
      }

      // Auto-approve edits to specific directories
      if (toolName === 'Edit' && typeof input.file_path === 'string') {
        if (input.file_path.startsWith('/project/src/')) {
          return { behavior: 'allow' };
        }
      }

      // Deny with a message
      return {
        behavior: 'deny',
        message: `Operation on ${toolName} not allowed outside /project/src/`,
      };
    },
  },
});
```

### Modify Tool Input

You can modify the tool input before execution by returning `updatedInput`:

```typescript
canUseTool: async (toolName, input, opts) => {
  if (toolName === 'Bash' && typeof input.command === 'string') {
    // Add a safety flag to all npm commands
    if (input.command.includes('npm install')) {
      return {
        behavior: 'allow',
        updatedInput: {
          ...input,
          command: input.command + ' --dry-run',
        },
      };
    }
  }
  return { behavior: 'allow' };
},
```

### Update Permissions Dynamically

Return `updatedPermissions` to add persistent permission rules:

```typescript
canUseTool: async (toolName, input, opts) => {
  // Use suggestions to create persistent rules
  if (opts.suggestions.length > 0) {
    return {
      behavior: 'allow',
      updatedPermissions: opts.suggestions.map(s => ({
        rule: s,
        behavior: 'allow' as const,
      })),
    };
  }
  return { behavior: 'allow' };
},
```

### Deny and Interrupt

Deny a tool call and optionally interrupt the entire agent:

```typescript
canUseTool: async (toolName, input, opts) => {
  if (toolName === 'Bash' && typeof input.command === 'string') {
    if (input.command.includes('rm -rf')) {
      return {
        behavior: 'deny',
        message: 'Destructive rm -rf commands are not allowed',
        interrupt: true,  // Stop the agent entirely
      };
    }
  }
  return { behavior: 'allow' };
},
```

## Changing Permissions Mid-Session

Use `setPermissionMode()` on the query object to change the permission mode during a running session:

```typescript
const q = query({
  prompt: 'Analyze and then fix the bugs',
  options: { permissionMode: 'default' },
});

for await (const message of q) {
  if (message.type === 'assistant') {
    // After analysis, switch to acceptEdits for the fix phase
    q.setPermissionMode('acceptEdits');
  }
}
```

## Complete Example: Multi-Level Permission Control

```typescript
import { query } from '@anthropic-ai/claude-agent-sdk';

const q = query({
  prompt: 'Review and fix security issues in the auth module',
  options: {
    cwd: '/path/to/project',
    permissionMode: 'default',

    // Auto-approve read-only tools
    allowedTools: ['Read', 'Glob', 'Grep', 'WebSearch'],

    // Remove Bash entirely (too dangerous for this task)
    disallowedTools: ['Bash'],

    // Custom callback for fine-grained control
    canUseTool: async (toolName, input, opts) => {
      // Auto-approve edits to the auth module only
      if (toolName === 'Edit' && typeof input.file_path === 'string') {
        if (input.file_path.includes('/auth/')) {
          return { behavior: 'allow' };
        }
        return {
          behavior: 'deny',
          message: 'Only edits to the auth module are allowed',
        };
      }

      // Auto-approve Write to test files
      if (toolName === 'Write' && typeof input.file_path === 'string') {
        if (input.file_path.includes('.test.')) {
          return { behavior: 'allow' };
        }
      }

      // Default: allow (permission mode will handle the rest)
      return { behavior: 'allow' };
    },
  },
});

for await (const message of q) {
  if (message.type === 'result') {
    console.log('Total cost:', message.total_cost_usd);
  }
}
```

## Related

- [Overview](./01-overview.md)
- [TypeScript API](./02-typescript-api.md)
- [User Input Handling](./06-user-input.md)
- [Hooks](./07-hooks.md)
