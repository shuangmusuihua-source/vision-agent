# Session Storage Adapters

The SDK supports custom session storage backends through the `SessionStore` adapter interface. This allows you to store sessions in S3, Redis, Postgres, or any custom backend.

## SessionStore Interface

The `SessionStore` interface defines the contract for session storage adapters:

```typescript
interface SessionStore {
  append(sessionId: string, data: string): Promise<void>;
  load(sessionId: string): Promise<string>;
  listSessions?(options?: ListSessionsOptions): Promise<SDKSessionInfo[]>;
  delete?(sessionId: string): Promise<void>;
  listSubkeys?(prefix: string): Promise<string[]>;
}
```

### Required Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `append` | `(sessionId: string, data: string) => Promise<void>` | Append data to a session log |
| `load` | `(sessionId: string) => Promise<string>` | Load the complete session log |

### Optional Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `listSessions` | `(options?: ListSessionsOptions) => Promise<SDKSessionInfo[]>` | List all sessions |
| `delete` | `(sessionId: string) => Promise<void>` | Delete a session |
| `listSubkeys` | `(prefix: string) => Promise<string[]>` | List subkeys with a given prefix |

## InMemorySessionStore

The SDK provides an in-memory session store for testing:

```typescript
import { InMemorySessionStore } from '@anthropic-ai/claude-agent-sdk';

const store = new InMemorySessionStore();

const q = query({
  prompt: 'Quick test query',
  options: {
    sessionStore: store,
    persistSession: false,
  },
});
```

> **Note:** `InMemorySessionStore` stores data in memory only. Data is lost when the process exits. Use it only for testing.

## Using SessionStore

Pass the `sessionStore` option to `query()`, `startup()`, `listSessions()`, and other session-related functions:

```typescript
import { query, listSessions } from '@anthropic-ai/claude-agent-sdk';

const store = new CustomSessionStore();

// Use with query
const q = query({
  prompt: 'Analyze the codebase',
  options: {
    sessionStore: store,
  },
});

// Use with listSessions
const sessions = await listSessions({
  sessionStore: store,
});
```

## Dual-Write Architecture

The SDK uses a dual-write approach for session storage:

1. **Local disk first** — Session data is always written to the local disk first (`~/.claude/projects/<encoded-cwd>/*.jsonl`)
2. **Mirror to store** — Then the data is mirrored to the custom session store

This ensures that:
- Local operations are fast (no network latency)
- If the custom store is unavailable, local data is still intact
- Sessions can be loaded from either source

## Implementing a Custom SessionStore

### S3 SessionStore

```typescript
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';

class S3SessionStore implements SessionStore {
  private client: S3Client;
  private bucket: string;
  private prefix: string;

  constructor(config: { bucket: string; prefix?: string; region?: string }) {
    this.client = new S3Client({ region: config.region || 'us-east-1' });
    this.bucket = config.bucket;
    this.prefix = config.prefix || 'claude-sessions/';
  }

  private getKey(sessionId: string): string {
    return `${this.prefix}${sessionId}.jsonl`;
  }

  async append(sessionId: string, data: string): Promise<void> {
    // Load existing data, append, then write back
    let existing = '';
    try {
      existing = await this.load(sessionId);
    } catch {
      // New session, no existing data
    }

    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: this.getKey(sessionId),
      Body: existing + data,
    }));
  }

  async load(sessionId: string): Promise<string> {
    const response = await this.client.send(new GetObjectCommand({
      Bucket: this.bucket,
      Key: this.getKey(sessionId),
    }));

    return await response.Body!.transformToString();
  }

  async listSessions(options?: ListSessionsOptions): Promise<SDKSessionInfo[]> {
    // Implement listing logic using S3 list operations
    // ...
    return [];
  }

  async delete(sessionId: string): Promise<void> {
    // Implement delete using S3 delete operation
    // ...
  }

  async listSubkeys(prefix: string): Promise<string[]> {
    // Implement using S3 list with prefix
    // ...
    return [];
  }
}
```

### Redis SessionStore

```typescript
import { createClient } from 'redis';

class RedisSessionStore implements SessionStore {
  private client;
  private keyPrefix: string;

  constructor(config: { url: string; keyPrefix?: string }) {
    this.client = createClient({ url: config.url });
    this.keyPrefix = config.keyPrefix || 'claude:session:';
  }

  private getKey(sessionId: string): string {
    return `${this.keyPrefix}${sessionId}`;
  }

  async append(sessionId: string, data: string): Promise<void> {
    await this.client.connect();
    await this.client.append(this.getKey(sessionId), data);
  }

  async load(sessionId: string): Promise<string> {
    await this.client.connect();
    const data = await this.client.get(this.getKey(sessionId));
    return data || '';
  }

  async delete(sessionId: string): Promise<void> {
    await this.client.connect();
    await this.client.del(this.getKey(sessionId));
  }
}
```

### Postgres SessionStore

```typescript
import { Pool } from 'pg';

class PostgresSessionStore implements SessionStore {
  private pool: Pool;
  private tableName: string;

  constructor(config: { connectionString: string; tableName?: string }) {
    this.pool = new Pool({ connectionString: config.connectionString });
    this.tableName = config.tableName || 'claude_sessions';
  }

  async append(sessionId: string, data: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO ${this.tableName} (session_id, data)
       VALUES ($1, $2)
       ON CONFLICT (session_id)
       DO UPDATE SET data = ${this.tableName}.data || $2`,
      [sessionId, data],
    );
  }

  async load(sessionId: string): Promise<string> {
    const result = await this.pool.query(
      `SELECT data FROM ${this.tableName} WHERE session_id = $1`,
      [sessionId],
    );
    return result.rows[0]?.data || '';
  }

  async listSessions(options?: ListSessionsOptions): Promise<SDKSessionInfo[]> {
    const result = await this.pool.query(
      `SELECT session_id, data FROM ${this.tableName} ORDER BY session_id`,
    );
    // Parse session info from data
    return result.rows.map(row => parseSessionInfo(row.session_id, row.data));
  }

  async delete(sessionId: string): Promise<void> {
    await this.pool.query(
      `DELETE FROM ${this.tableName} WHERE session_id = $1`,
      [sessionId],
    );
  }
}
```

## Database Initialization

For Postgres and similar databases, you need to create the table before using the store:

```sql
CREATE TABLE IF NOT EXISTS claude_sessions (
  session_id VARCHAR(255) PRIMARY KEY,
  data TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sessions_updated
  ON claude_sessions (updated_at);
```

## Error Handling

When the session store encounters an error:

1. **Append failure** — The SDK logs a warning but does not crash. Local data is still intact.
2. **Load failure** — The SDK falls back to loading from local disk.
3. **List failure** — The `listSessions()` function returns an empty array or throws.

Implement retry logic in your store for transient failures:

```typescript
async append(sessionId: string, data: string): Promise<void> {
  const maxRetries = 3;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await this.doAppend(sessionId, data);
      return;
    } catch (error) {
      if (attempt === maxRetries) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
    }
  }
}
```

## Complete Example: S3 Session Store

```typescript
import { query } from '@anthropic-ai/claude-agent-sdk';
import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command, DeleteObjectCommand } from '@aws-sdk/client-s3';

class S3SessionStore implements SessionStore {
  private client: S3Client;
  private bucket: string;
  private prefix: string;

  constructor(config: { bucket: string; prefix?: string; region?: string }) {
    this.client = new S3Client({ region: config.region || 'us-east-1' });
    this.bucket = config.bucket;
    this.prefix = config.prefix || 'claude-sessions/';
  }

  private getKey(sessionId: string): string {
    return `${this.prefix}${sessionId}.jsonl`;
  }

  async append(sessionId: string, data: string): Promise<void> {
    let existing = '';
    try { existing = await this.load(sessionId); } catch { /* new session */ }

    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: this.getKey(sessionId),
      Body: existing + data,
    }));
  }

  async load(sessionId: string): Promise<string> {
    const response = await this.client.send(new GetObjectCommand({
      Bucket: this.bucket,
      Key: this.getKey(sessionId),
    }));
    return await response.Body!.transformToString();
  }

  async delete(sessionId: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: this.getKey(sessionId),
    }));
  }
}

// Usage
const store = new S3SessionStore({
  bucket: 'my-claude-sessions',
  prefix: 'sessions/',
  region: 'us-east-1',
});

const q = query({
  prompt: 'Analyze the codebase',
  options: {
    sessionStore: store,
    cwd: '/path/to/project',
  },
});
```

## Related

- [Overview](./01-overview.md)
- [TypeScript API](./02-typescript-api.md)
- [Sessions](./03-sessions.md)
- [Cost Tracking](./15-cost-tracking.md)
