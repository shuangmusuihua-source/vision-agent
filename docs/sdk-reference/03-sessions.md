# Session Management

The SDK provides comprehensive session management, allowing you to continue, resume, fork, and query previous sessions.

## Session Lifecycle

### Creating a Session

A new session is created automatically when you call `query()` without any session options:

```typescript
import { query } from '@anthropic-ai/claude-agent-sdk';

const q = query({
  prompt: 'Analyze the authentication module',
  options: {
    cwd: '/path/to/project',
    persistSession: true,  // default
  },
});

for await (const message of q) {
  if (message.type === 'result') {
    console.log('Session ID:', message.session_id);
  }
}
```

### Getting the Session ID

The session ID is available from two sources:

1. **`ResultMessage.session_id`** — The session ID is included in the final result message.
2. **`SDKSystemMessage` (init)** — The initialization system message contains `session_id`.

```typescript
for await (const message of q) {
  if (message.type === 'system' && message.subtype === 'init') {
    console.log('Session started:', message.session_id);
  }
  if (message.type === 'result') {
    console.log('Session completed:', message.session_id);
  }
}
```

### Custom Session ID

You can specify a custom session ID using the `sessionId` option:

```typescript
const q = query({
  prompt: 'Analyze the codebase',
  options: {
    sessionId: 'my-custom-session-id',
  },
});
```

## Continuing a Session

### Continue Most Recent Session

Set `continue: true` to resume the most recent session in the project:

```typescript
const q = query({
  prompt: 'Now add unit tests for the auth module',
  options: {
    continue: true,
    cwd: '/path/to/project',
  },
});
```

### Resume a Specific Session

Set `resume` to a session ID to resume a specific session:

```typescript
const q = query({
  prompt: 'Continue the refactoring',
  options: {
    resume: 'session-abc123',
    cwd: '/path/to/project',
  },
});
```

### Fork a Session

Set `forkSession: true` along with `resume` to create a branch from an existing session. The original session is preserved, and the new query starts from that point but can diverge:

```typescript
const q = query({
  prompt: 'Try a different approach to the refactoring',
  options: {
    resume: 'session-abc123',
    forkSession: true,
    cwd: '/path/to/project',
  },
});
```

> **Note:** `forkSession` requires `resume` to be set. It creates a new session that starts from the same point as the resumed session but can take a different path.

## Disabling Session Persistence

Set `persistSession: false` to prevent the session from being written to disk. This is only available in the TypeScript SDK:

```typescript
const q = query({
  prompt: 'Quick one-off query',
  options: {
    persistSession: false,
  },
});
```

> **Warning:** With `persistSession: false`, the session cannot be resumed later. This is useful for ephemeral or sensitive queries.

## Session Query Functions

### `listSessions(options?)`

List all sessions for the current project directory:

```typescript
import { listSessions } from '@anthropic-ai/claude-agent-sdk';

const sessions = await listSessions({ cwd: '/path/to/project' });

for (const session of sessions) {
  console.log({
    id: session.session_id,
    title: session.title,
    lastUpdated: session.last_updated,
  });
}
```

**`SDKSessionInfo` fields:**

| Field | Type | Description |
|-------|------|-------------|
| `session_id` | `string` | Unique session identifier |
| `title` | `string?` | Session title |
| `last_updated` | `string` | ISO timestamp of last update |
| `created_at` | `string` | ISO timestamp of creation |
| `tags` | `string[]` | Session tags |
| `model` | `string?` | Model used in session |
| `turns` | `number?` | Number of turns |

### `getSessionMessages(sessionId, options?)`

Retrieve all messages from a specific session:

```typescript
import { getSessionMessages } from '@anthropic-ai/claude-agent-sdk';

const messages = await getSessionMessages('session-abc123', {
  cwd: '/path/to/project',
});

for (const msg of messages) {
  console.log(msg.type, msg.role);
}
```

### `getSessionInfo(sessionId, options?)`

Get metadata for a specific session:

```typescript
import { getSessionInfo } from '@anthropic-ai/claude-agent-sdk';

const info = await getSessionInfo('session-abc123', {
  cwd: '/path/to/project',
});

if (info) {
  console.log('Title:', info.title);
  console.log('Model:', info.model);
  console.log('Turns:', info.turns);
}
```

### `renameSession(sessionId, title, options?)`

Rename a session:

```typescript
import { renameSession } from '@anthropic-ai/claude-agent-sdk';

await renameSession('session-abc123', 'Authentication Refactoring', {
  cwd: '/path/to/project',
});
```

### `tagSession(sessionId, tag, options?)`

Add a tag to a session for categorization:

```typescript
import { tagSession } from '@anthropic-ai/claude-agent-sdk';

await tagSession('session-abc123', 'bugfix', { cwd: '/path/to/project' });
await tagSession('session-abc123', 'auth', { cwd: '/path/to/project' });
```

## Session Storage Location

Sessions are stored on disk as JSONL files:

```
~/.claude/projects/<encoded-cwd>/*.jsonl
```

Where `<encoded-cwd>` is the project directory path with slashes replaced by dashes.

For example, a project at `/home/user/my-app` would store sessions under:

```
~/.claude/projects/-home-user-my-app/*.jsonl
```

## Session with Custom Storage

Use the `sessionStore` option to store sessions in a custom backend (S3, Redis, Postgres, etc.):

```typescript
import { query } from '@anthropic-ai/claude-agent-sdk';
import { S3SessionStore } from './s3-session-store';

const store = new S3SessionStore({ bucket: 'my-sessions' });

const q = query({
  prompt: 'Analyze the codebase',
  options: {
    sessionStore: store,
    cwd: '/path/to/project',
  },
});
```

See [14-session-storage.md](./14-session-storage.md) for full details on implementing custom session stores.

## Complete Example: Session Workflow

```typescript
import {
  query,
  listSessions,
  getSessionInfo,
  renameSession,
} from '@anthropic-ai/claude-agent-sdk';

async function sessionWorkflow() {
  // Start a new session
  let sessionId: string | undefined;

  const q1 = query({
    prompt: 'Review the authentication module',
    options: { cwd: '/path/to/project' },
  });

  for await (const message of q1) {
    if (message.type === 'system' && message.subtype === 'init') {
      sessionId = message.session_id;
    }
    if (message.type === 'result') {
      console.log('First query cost:', message.total_cost_usd);
    }
  }

  if (!sessionId) return;

  // Rename the session
  await renameSession(sessionId, 'Auth Review', { cwd: '/path/to/project' });

  // Continue the session
  const q2 = query({
    prompt: 'Now fix the issues you found',
    options: {
      continue: true,
      cwd: '/path/to/project',
    },
  });

  for await (const message of q2) {
    if (message.type === 'result') {
      console.log('Second query cost:', message.total_cost_usd);
    }
  }

  // List all sessions
  const sessions = await listSessions({ cwd: '/path/to/project' });
  console.log(`Found ${sessions.length} sessions`);

  // Get details of our session
  const info = await getSessionInfo(sessionId!, { cwd: '/path/to/project' });
  console.log('Session info:', info);
}
```

## Related

- [Overview](./01-overview.md)
- [TypeScript API](./02-typescript-api.md)
- [Session Storage Adapters](./14-session-storage.md)
- [Cost Tracking](./15-cost-tracking.md)
