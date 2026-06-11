# File Checkpointing

File checkpointing allows you to track file changes made by the agent and rewind them to a previous state. This is useful for undoing unwanted changes or testing different approaches.

## Enabling File Checkpointing

Set `enableFileCheckpointing: true` along with `extraArgs: { 'replay-user-messages': null }` to enable checkpointing:

```typescript
import { query } from '@anthropic-ai/claude-agent-sdk';

const q = query({
  prompt: 'Refactor the authentication module',
  options: {
    enableFileCheckpointing: true,
    extraArgs: { 'replay-user-messages': null },
  },
});
```

> **Note:** Both options are required. `enableFileCheckpointing` enables the tracking mechanism, and `'replay-user-messages'` ensures that user messages are replayed correctly when rewinding.

## How Checkpointing Works

### Checkpoint Creation

When file checkpointing is enabled, the SDK creates a checkpoint each time the agent makes file changes. Each checkpoint captures:

- The files that were modified
- The state of those files before the modification
- A unique checkpoint UUID

### Capturing the Checkpoint UUID

Checkpoint UUIDs are available from `SDKUserMessage.uuid`. Save this ID to use for rewinding later:

```typescript
const checkpoints: Map<string, string> = new Map();

for await (const message of q) {
  if (message.type === 'user') {
    // Save checkpoint ID for each user message
    checkpoints.set(message.uuid, `Checkpoint at turn ${checkpoints.size + 1}`);
    console.log(`Checkpoint: ${message.uuid}`);
  }
}
```

### What Is Tracked

File checkpointing only tracks changes made by the **Write** and **Edit** tools (and `NotebookEdit`). It does **NOT** track:

- Changes made by `Bash` commands (e.g., `git checkout`, `npm install`)
- Changes to files outside the working directory
- Changes made by MCP server tools

> **Warning:** If the agent runs `Bash` commands that modify files, those changes will NOT be captured by checkpointing. Consider restricting Bash access when using checkpointing.

## Rewinding Files

Use the `rewindFiles()` method on the query object to revert files to a previous checkpoint:

### Basic Rewind

```typescript
await q.rewindFiles(checkpointId);
```

### Dry Run

Use `dryRun: true` to preview what changes would be made without actually applying them:

```typescript
const result = await q.rewindFiles(checkpointId, { dryRun: true });
console.log('Would revert these files:', result.files);
```

### After Rewind

After rewinding, the agent continues from the checkpoint state. The conversation history after the checkpoint is removed, and the agent can take a different path.

## Complete Example: Checkpoint-Based Workflow

```typescript
import { query } from '@anthropic-ai/claude-agent-sdk';

async function checkpointWorkflow() {
  const q = query({
    prompt: 'Refactor the authentication module',
    options: {
      enableFileCheckpointing: true,
      extraArgs: { 'replay-user-messages': null },
      cwd: '/path/to/project',
      permissionMode: 'acceptEdits',
    },
  });

  const checkpointHistory: Array<{ id: string; label: string }> = [];

  for await (const message of q) {
    if (message.type === 'user') {
      // Record each checkpoint
      checkpointHistory.push({
        id: message.uuid,
        label: `After turn ${checkpointHistory.length + 1}`,
      });
    }

    if (message.type === 'result') {
      console.log('Agent completed. Total cost:', message.total_cost_usd);
    }
  }

  // Review the changes and decide to rewind
  if (checkpointHistory.length > 2) {
    // Dry run first
    const targetCheckpoint = checkpointHistory[1];
    console.log(`Rewinding to: ${targetCheckpoint.label}`);

    const dryRunResult = await q.rewindFiles(targetCheckpoint.id, { dryRun: true });
    console.log('Files that would be reverted:', dryRunResult);

    // Actually rewind
    await q.rewindFiles(targetCheckpoint.id);
    console.log('Files reverted to checkpoint');
  }
}
```

## Checkpointing with Session Resume

When resuming a session that had checkpointing enabled, checkpoints from the previous session are still valid:

```typescript
// First session
const q1 = query({
  prompt: 'Start refactoring',
  options: {
    enableFileCheckpointing: true,
    extraArgs: { 'replay-user-messages': null },
  },
});

let firstCheckpointId: string | undefined;
for await (const message of q1) {
  if (message.type === 'user' && !firstCheckpointId) {
    firstCheckpointId = message.uuid;
  }
  if (message.type === 'result') {
    console.log('Session ID:', message.session_id);
  }
}

// Later, resume the session
const q2 = query({
  prompt: 'Try a different approach',
  options: {
    continue: true,
    enableFileCheckpointing: true,
    extraArgs: { 'replay-user-messages': null },
  },
});

// Can still rewind to the checkpoint from the first session
if (firstCheckpointId) {
  const result = await q2.rewindFiles(firstCheckpointId, { dryRun: true });
  console.log('Dry run result:', result);
}
```

## Limitations

| Limitation | Description |
|------------|-------------|
| **Bash changes not tracked** | File modifications via Bash are not captured |
| **MCP tool changes not tracked** | Changes made by MCP server tools are not captured |
| **External process changes** | Changes by other processes are not captured |
| **Binary files** | Checkpointing may not work correctly with binary files |
| **Memory overhead** | Checkpointing stores file snapshots, which increases memory usage |

## Best Practices

1. **Restrict Bash access** — When using checkpointing, consider removing or restricting `Bash` from `allowedTools` to ensure all file changes are tracked
2. **Save checkpoint IDs early** — Capture `uuid` from user messages as they arrive
3. **Use dry run first** — Always preview rewinds with `dryRun: true` before applying
4. **Combine with session persistence** — Use `persistSession: true` (default) to ensure checkpoints survive across sessions
5. **Clean up checkpoints** — Old checkpoints consume memory; close the query when done

## Related

- [Overview](./01-overview.md)
- [TypeScript API](./02-typescript-api.md)
- [Sessions](./03-sessions.md)
- [Permissions](./05-permissions.md)
