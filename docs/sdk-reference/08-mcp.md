# MCP Server Integration

The SDK supports Model Context Protocol (MCP) servers, which extend the agent with additional tools and resources. MCP servers can be connected via multiple transport types.

## Transport Types

| Transport | Description | Use Case |
|-----------|-------------|----------|
| `stdio` | Standard input/output | Local process-based servers |
| `SSE` | Server-Sent Events | HTTP-based streaming servers |
| `HTTP` | HTTP request/response | REST API servers |
| `SDK` | In-process SDK server | Custom tools registered via `tool()` |

## Configuration

MCP servers are configured via the `mcpServers` option:

```typescript
import { query } from '@anthropic-ai/claude-agent-sdk';

const q = query({
  prompt: 'Search the database',
  options: {
    mcpServers: {
      // stdio transport
      'my-server': {
        type: 'stdio',
        command: 'node',
        args: ['path/to/server.js'],
        env: { API_KEY: 'secret' },
      },

      // SSE transport
      'remote-server': {
        type: 'sse',
        url: 'https://mcp.example.com/sse',
        headers: { Authorization: 'Bearer token' },
      },

      // HTTP transport
      'api-server': {
        type: 'http',
        url: 'https://mcp.example.com/api',
        headers: { Authorization: 'Bearer token' },
      },
    },
  },
});
```

## stdio Transport

The `stdio` transport spawns a local process and communicates via standard input/output:

```typescript
mcpServers: {
  'filesystem': {
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '/path/to/dir'],
    env: {
      // Optional environment variables
      NODE_ENV: 'production',
    },
  },
}
```

**Configuration fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `'stdio'` | Yes | Transport type |
| `command` | `string` | Yes | Command to execute |
| `args` | `string[]` | No | Command arguments |
| `env` | `Record<string, string>` | No | Environment variables |

## SSE Transport

The `SSE` transport connects to a server using Server-Sent Events:

```typescript
mcpServers: {
  'remote-api': {
    type: 'sse',
    url: 'https://mcp.example.com/sse',
    headers: {
      Authorization: 'Bearer my-token',
    },
  },
}
```

**Configuration fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `'sse'` | Yes | Transport type |
| `url` | `string` | Yes | SSE endpoint URL |
| `headers` | `Record<string, string>` | No | HTTP headers |

## HTTP Transport

The `HTTP` transport connects to a server using standard HTTP requests:

```typescript
mcpServers: {
  'rest-api': {
    type: 'http',
    url: 'https://mcp.example.com/api',
    headers: {
      Authorization: 'Bearer my-token',
    },
  },
}
```

**Configuration fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `'http'` | Yes | Transport type |
| `url` | `string` | Yes | API endpoint URL |
| `headers` | `Record<string, string>` | No | HTTP headers |

## SDK (In-Process) Transport

The `SDK` transport creates an in-process MCP server from custom tool definitions. This is the recommended approach for adding custom tools:

```typescript
import { query, tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';

// Define custom tools
const searchTool = tool(
  'search',
  'Search the project database',
  {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query' },
      limit: { type: 'number', description: 'Max results' },
    },
    required: ['query'],
  },
  async (input) => {
    const results = await db.search(input.query, input.limit);
    return {
      content: [{ type: 'text', text: JSON.stringify(results) }],
    };
  },
  {
    annotations: { readOnlyHint: true },
  },
);

const updateTool = tool(
  'update',
  'Update a database record',
  {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Record ID' },
      data: { type: 'object', description: 'Updated fields' },
    },
    required: ['id', 'data'],
  },
  async (input) => {
    const result = await db.update(input.id, input.data);
    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
    };
  },
);

// Create the SDK MCP server
const server = createSdkMcpServer({
  name: 'database-tools',
  version: '1.0.0',
  tools: [searchTool, updateTool],
});

// Use it in a query
const q = query({
  prompt: 'Search for user records and update the inactive ones',
  options: {
    mcpServers: {
      'database-tools': server,
    },
  },
});
```

> **Note:** SDK-type servers are passed directly as the server config object (not wrapped in a transport config). The `createSdkMcpServer()` return value implements `McpSdkServerConfigWithInstance`.

## Tool Name Convention

MCP tools are referenced using the naming convention:

```
mcp__{serverName}__{toolName}
```

For example, a tool named `search` on a server named `database-tools` would be referenced as:

```
mcp__database-tools__search
```

This convention is used in:
- `allowedTools` and `disallowedTools`
- Hook matcher patterns
- `canUseTool` callback `toolName` parameter
- Tool use messages

## Runtime MCP Management

### Check Server Status

```typescript
const q = query({ prompt: 'Analyze', options: { mcpServers } });

const status = q.mcpServerStatus();
for (const server of status) {
  console.log(`${server.name}: ${server.connected ? 'connected' : 'disconnected'}`);
}
```

### Reconnect a Server

```typescript
await q.reconnectMcpServer('database-tools');
```

### Toggle a Server

```typescript
// Disable a server
q.toggleMcpServer('database-tools', false);

// Re-enable a server
q.toggleMcpServer('database-tools', true);
```

### Update Server Configuration

```typescript
q.setMcpServers({
  'new-server': {
    type: 'stdio',
    command: 'node',
    args: ['new-server.js'],
  },
});
```

## Complete Example: Multi-Server Setup

```typescript
import { query, tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';

// Custom in-process tools
const logTool = tool(
  'write_log',
  'Write an entry to the application log',
  {
    type: 'object',
    properties: {
      level: { type: 'string', enum: ['info', 'warn', 'error'] },
      message: { type: 'string' },
    },
    required: ['level', 'message'],
  },
  async (input) => {
    await appendToLog(input.level, input.message);
    return { content: [{ type: 'text', text: 'Log entry written' }] };
  },
);

const logServer = createSdkMcpServer({
  name: 'app-logs',
  tools: [logTool],
});

const q = query({
  prompt: 'Analyze the application logs and identify issues',
  options: {
    mcpServers: {
      // Custom in-process server
      'app-logs': logServer,

      // External database server
      'database': {
        type: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-postgres', 'postgresql://localhost/mydb'],
      },

      // Remote API server
      'monitoring': {
        type: 'sse',
        url: 'https://monitoring.example.com/mcp/sse',
        headers: { Authorization: 'Bearer token' },
      },
    },
    allowedTools: [
      'Read', 'Glob', 'Grep',
      'mcp__app-logs__write_log',
      'mcp__database__query',
      'mcp__monitoring__get_metrics',
    ],
  },
});

for await (const message of q) {
  if (message.type === 'result') {
    console.log('Analysis complete');
  }
}
```

## Related

- [Overview](./01-overview.md)
- [TypeScript API](./02-typescript-api.md)
- [Custom Tools](./12-custom-tools.md)
- [Permissions](./05-permissions.md)
