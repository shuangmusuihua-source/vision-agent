# Custom Tools

Custom tools extend the agent's capabilities by providing new tools through MCP servers. Use `tool()` to define tools and `createSdkMcpServer()` to create in-process MCP servers.

## Defining a Tool

### `tool(name, description, inputSchema, handler, extras?)`

Create a custom tool definition:

```typescript
import { tool } from '@anthropic-ai/claude-agent-sdk';

const searchTool = tool(
  'search',                                    // Tool name
  'Search the project database for records',   // Description
  {                                            // JSON Schema for inputs
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search query or SQL filter',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of results to return',
      },
    },
    required: ['query'],
  },
  async (input) => {                           // Handler function
    const results = await db.search(input.query, input.limit);
    return {
      content: [{ type: 'text', text: JSON.stringify(results, null, 2) }],
    };
  },
  {                                           // Optional extras
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
    },
  },
);
```

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | `string` | Yes | Tool name. Must be unique within the server. Used in `mcp__{server}__{name}` |
| `description` | `string` | Yes | Description shown to the model. Be specific for best results |
| `inputSchema` | `object` | Yes | JSON Schema defining the tool's input parameters |
| `handler` | `(input: T) => Promise<ToolResult>` | Yes | Async function that executes the tool |
| `extras` | `{ annotations?: ToolAnnotations }` | No | Optional annotations |

### ToolAnnotations

Annotations provide hints about the tool's behavior:

```typescript
interface ToolAnnotations {
  readOnlyHint?: boolean;       // Tool only reads, never modifies
  destructiveHint?: boolean;    // Tool may make destructive changes
  idempotentHint?: boolean;     // Repeated calls have the same effect
  openWorldHint?: boolean;      // Tool interacts with external systems
}
```

| Annotation | Effect |
|------------|--------|
| `readOnlyHint: true` | Suggests the tool does not modify state. May influence permission decisions |
| `destructiveHint: true` | Warns that the tool may make irreversible changes |
| `idempotentHint: true` | Indicates that calling the tool multiple times with the same input produces the same result |
| `openWorldHint: true` | Indicates the tool interacts with external/network resources |

## Creating an MCP Server

### `createSdkMcpServer({ name, version?, tools? })`

Create an in-process MCP server that hosts your custom tools:

```typescript
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';

const searchTool = tool(
  'search',
  'Search the database',
  {
    type: 'object',
    properties: { query: { type: 'string' } },
    required: ['query'],
  },
  async (input) => {
    const results = await db.search(input.query);
    return { content: [{ type: 'text', text: JSON.stringify(results) }] };
  },
);

const updateTool = tool(
  'update',
  'Update a record',
  {
    type: 'object',
    properties: {
      id: { type: 'string' },
      data: { type: 'object' },
    },
    required: ['id', 'data'],
  },
  async (input) => {
    const result = await db.update(input.id, input.data);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  },
);

const server = createSdkMcpServer({
  name: 'database-tools',
  version: '1.0.0',
  tools: [searchTool, updateTool],
});
```

### Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `name` | `string` | — | Server name. Used in the tool name prefix |
| `version` | `string?` | `'1.0.0'` | Server version |
| `tools` | `SdkMcpToolDefinition[]?` | `[]` | List of tool definitions |

## Using Custom Tools in a Query

Pass the MCP server instance via the `mcpServers` option:

```typescript
import { query } from '@anthropic-ai/claude-agent-sdk';

const q = query({
  prompt: 'Search for all users created in the last week',
  options: {
    mcpServers: {
      'database-tools': server,  // Pass the server instance directly
    },
  },
});
```

### Tool Name Convention

Custom tools are referenced using the naming convention:

```
mcp__{serverName}__{toolName}
```

For the example above:
- `mcp__database-tools__search` — The search tool
- `mcp__database-tools__update` — The update tool

Use these names in `allowedTools` and `disallowedTools`:

```typescript
const q = query({
  prompt: 'Search for users',
  options: {
    mcpServers: {
      'database-tools': server,
    },
    allowedTools: [
      'Read', 'Glob', 'Grep',
      'mcp__database-tools__search',  // Auto-approve search
      // Don't auto-approve update — requires permission
    ],
  },
});
```

## Tool Handler

### Return Format

Tool handlers must return an object with a `content` array:

```typescript
async (input) => {
  return {
    content: [
      { type: 'text', text: 'Result text' },
    ],
  };
};
```

### Returning Structured Data

Return JSON-serialized data for structured results:

```typescript
async (input) => {
  const users = await db.getUsers(input.query);
  return {
    content: [{
      type: 'text',
      text: JSON.stringify(users, null, 2),
    }],
  };
};
```

### Returning Images

Return base64-encoded images:

```typescript
async (input) => {
  const imageBuffer = await generateChart(input.data);
  return {
    content: [{
      type: 'image',
      data: imageBuffer.toString('base64'),
      mimeType: 'image/png',
    }],
  };
};
```

### Returning Resources

Return MCP resources:

```typescript
async (input) => {
  return {
    content: [{
      type: 'resource',
      resource: {
        uri: 'file:///path/to/file',
        mimeType: 'text/plain',
        text: 'File contents',
      },
    }],
  };
};
```

## Error Handling

> **Important:** Do not throw errors from tool handlers. Instead, return `isError: true` in the result.

```typescript
const deleteTool = tool(
  'delete_record',
  'Delete a record from the database',
  {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Record ID to delete' },
    },
    required: ['id'],
  },
  async (input) => {
    try {
      const result = await db.delete(input.id);
      return {
        content: [{ type: 'text', text: `Deleted record ${input.id}` }],
      };
    } catch (error) {
      // Return error result instead of throwing
      return {
        content: [{
          type: 'text',
          text: `Failed to delete record: ${error instanceof Error ? error.message : String(error)}`,
        }],
        isError: true,
      };
    }
  },
  {
    annotations: { destructiveHint: true },
  },
);
```

## Using the `tools` Shorthand

For simple cases, you can pass tool definitions directly via the `tools` option without creating a named server:

```typescript
const q = query({
  prompt: 'Analyze the project',
  options: {
    tools: [
      tool('analyze', 'Analyze code quality', { /* schema */ }, async (input) => {
        // ...
        return { content: [{ type: 'text', text: 'Analysis complete' }] };
      }),
    ],
  },
});
```

## Complete Example: Full Custom Tool Suite

```typescript
import { query, tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';

// Define tools
const queryTool = tool(
  'query',
  'Run a read-only SQL query against the database',
  {
    type: 'object',
    properties: {
      sql: { type: 'string', description: 'SQL query (SELECT only)' },
    },
    required: ['sql'],
  },
  async (input) => {
    if (!input.sql.trim().toUpperCase().startsWith('SELECT')) {
      return {
        content: [{ type: 'text', text: 'Only SELECT queries are allowed' }],
        isError: true,
      };
    }
    const results = await db.query(input.sql);
    return {
      content: [{ type: 'text', text: JSON.stringify(results, null, 2) }],
    };
  },
  { annotations: { readOnlyHint: true } },
);

const migrateTool = tool(
  'migrate',
  'Run a database migration',
  {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Migration name' },
      sql: { type: 'string', description: 'Migration SQL' },
    },
    required: ['name', 'sql'],
  },
  async (input) => {
    try {
      await db.migrate(input.name, input.sql);
      return {
        content: [{ type: 'text', text: `Migration "${input.name}" applied successfully` }],
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `Migration failed: ${error instanceof Error ? error.message : String(error)}`,
        }],
        isError: true,
      };
    }
  },
  { annotations: { destructiveHint: true, idempotentHint: false } },
);

const schemaTool = tool(
  'schema',
  'Get the database schema',
  {
    type: 'object',
    properties: {
      table: { type: 'string', description: 'Optional table name to filter' },
    },
  },
  async (input) => {
    const schema = await db.getSchema(input.table);
    return {
      content: [{ type: 'text', text: JSON.stringify(schema, null, 2) }],
    };
  },
  { annotations: { readOnlyHint: true } },
);

// Create server
const dbServer = createSdkMcpServer({
  name: 'postgres',
  version: '1.0.0',
  tools: [queryTool, migrateTool, schemaTool],
});

// Use in a query
const q = query({
  prompt: 'Review the database schema and suggest improvements',
  options: {
    mcpServers: { 'postgres': dbServer },
    allowedTools: [
      'Read', 'Glob', 'Grep',
      'mcp__postgres__query',
      'mcp__postgres__schema',
    ],
  },
});

for await (const message of q) {
  if (message.type === 'result') {
    console.log('Review complete. Cost:', message.total_cost_usd);
  }
}
```

## Related

- [Overview](./01-overview.md)
- [TypeScript API](./02-typescript-api.md)
- [MCP Server Integration](./08-mcp.md)
- [Permissions](./05-permissions.md)
