# Subagents

Subagents allow the main agent to delegate tasks to specialized child agents. Each subagent runs its own agent loop with its own configuration.

## AgentDefinition

Subagents are defined using the `AgentDefinition` interface:

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

## Configuring Subagents

Subagents are registered via the `agents` option on `query()`:

```typescript
import { query } from '@anthropic-ai/claude-agent-sdk';

const q = query({
  prompt: 'Analyze the codebase and fix all security issues',
  options: {
    agents: [
      {
        description: 'Security auditor that reviews code for vulnerabilities',
        prompt: 'You are a security expert. Analyze code for security vulnerabilities including XSS, SQL injection, CSRF, and authentication issues. Report findings with severity levels.',
        tools: ['Read', 'Glob', 'Grep'],
        model: 'claude-sonnet-4-20250514',
        effort: 'high',
        permissionMode: 'default',
      },
      {
        description: 'Code fixer that applies security patches',
        prompt: 'You are a code fixer specializing in security patches. Apply minimal, targeted fixes for the security issues identified. Do not introduce new vulnerabilities.',
        tools: ['Read', 'Write', 'Edit', 'Glob', 'Grep'],
        permissionMode: 'acceptEdits',
        effort: 'high',
      },
    ],
    allowedTools: ['Agent'],  // Required to allow the agent to spawn subagents
  },
});
```

> **Important:** You must include `'Agent'` in `allowedTools` (or use a permissive permission mode) for the main agent to be able to spawn subagents.

## How Subagents Work

### Spawning

When the main agent decides to use a subagent:

1. It uses the `Agent` tool with the name of the desired subagent
2. A `SubagentStart` hook fires on the parent
3. The subagent begins its own agent loop with the configured settings
4. Messages from the subagent include `parent_tool_use_id` to link them to the parent's tool call

### Execution

The subagent runs independently with its own:
- System prompt (from `AgentDefinition.prompt`)
- Tool set (from `AgentDefinition.tools`)
- Permission mode (from `AgentDefinition.permissionMode`)
- Model (from `AgentDefinition.model`, or inherits from parent)

### Completion

When the subagent finishes:

1. A `SubagentStop` hook fires on the parent
2. The subagent's result is returned as a tool result to the parent
3. The parent can then use the result in its continued execution

### Nesting Limit

> **Important:** Subagents cannot spawn their own subagents. The nesting depth is limited to one level.

## Dynamic Agent Configuration

Agent definitions can be created dynamically using factory functions:

```typescript
function createCodeReviewAgent(focus: string): AgentDefinition {
  return {
    description: `Code reviewer focused on ${focus}`,
    prompt: `You are a code reviewer. Focus specifically on ${focus}. Review code for best practices, potential bugs, and improvements in your focus area.`,
    tools: ['Read', 'Glob', 'Grep'],
    effort: 'medium',
    permissionMode: 'default',
  };
}

const q = query({
  prompt: 'Review the codebase',
  options: {
    agents: [
      createCodeReviewAgent('performance'),
      createCodeReviewAgent('security'),
      createCodeReviewAgent('accessibility'),
    ],
    allowedTools: ['Agent'],
  },
});
```

## Background Subagents

Set `background: true` to run a subagent in the background. The parent agent can continue working while the subagent runs:

```typescript
agents: [
  {
    description: 'Background test runner',
    prompt: 'Run the test suite and report results',
    tools: ['Bash', 'Read'],
    background: true,
    permissionMode: 'acceptEdits',
  },
],
```

## Subagent with Memory

Enable memory for a subagent to allow it to persist and recall information:

```typescript
agents: [
  {
    description: 'Knowledge base builder',
    prompt: 'You build and maintain a knowledge base. Read the codebase and create structured notes about the architecture.',
    tools: ['Read', 'Glob', 'Grep', 'Write'],
    memory: true,
    permissionMode: 'acceptEdits',
  },
],
```

## Subagent with MCP Servers

Subagents can have their own MCP server configurations:

```typescript
agents: [
  {
    description: 'Database analyst',
    prompt: 'You analyze database schemas and queries. Use the database MCP tools to inspect schemas and run queries.',
    tools: ['Read', 'mcp__database__query', 'mcp__database__schema'],
    mcpServers: {
      'database': {
        type: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-postgres', 'postgresql://localhost/mydb'],
      },
    },
    permissionMode: 'default',
  },
],
```

## Tracking Subagent Messages

Subagent messages include `parent_tool_use_id` to link them back to the parent agent's tool call. Use this to filter or track subagent activity:

```typescript
for await (const message of q) {
  if (message.type === 'assistant' && message.parent_tool_use_id) {
    console.log('Subagent message:', message.parent_tool_use_id);
  }
}
```

## Hooks for Subagents

Use `SubagentStart` and `SubagentStop` hooks to monitor subagent lifecycle:

```typescript
const q = query({
  prompt: 'Analyze the codebase',
  options: {
    agents: [/* ... */],
    allowedTools: ['Agent'],
    hooks: {
      SubagentStart: [{
        hooks: [async (input, toolUseID, ctx) => {
          console.log(`Subagent started: ${input.agent_name}`);
          return {};
        }],
      }],
      SubagentStop: [{
        hooks: [async (input, toolUseID, ctx) => {
          console.log(`Subagent stopped: ${input.agent_name}`);
          return {};
        }],
      }],
    },
  },
});
```

## Complete Example: Multi-Agent Workflow

```typescript
import { query } from '@anthropic-ai/claude-agent-sdk';

const q = query({
  prompt: 'Perform a comprehensive code review of the authentication module',
  options: {
    cwd: '/path/to/project',
    agents: [
      {
        description: 'Security reviewer — identifies vulnerabilities and security issues',
        prompt: 'You are a security expert. Analyze code for vulnerabilities including: injection attacks, authentication bypass, insecure data storage, CSRF, XSS. Rate each finding as critical/high/medium/low.',
        tools: ['Read', 'Glob', 'Grep'],
        effort: 'high',
        permissionMode: 'default',
      },
      {
        description: 'Performance reviewer — identifies performance bottlenecks',
        prompt: 'You are a performance expert. Analyze code for: N+1 queries, memory leaks, inefficient algorithms, unnecessary re-renders, blocking operations. Provide specific optimization suggestions.',
        tools: ['Read', 'Glob', 'Grep'],
        effort: 'medium',
        permissionMode: 'default',
      },
      {
        description: 'Code quality reviewer — identifies code smells and best practice violations',
        prompt: 'You are a code quality expert. Analyze code for: SOLID violations, code duplication, poor naming, missing error handling, test coverage gaps. Suggest concrete improvements.',
        tools: ['Read', 'Glob', 'Grep'],
        effort: 'medium',
        permissionMode: 'default',
      },
    ],
    allowedTools: ['Agent', 'Read', 'Glob', 'Grep'],
  },
});

for await (const message of q) {
  if (message.type === 'assistant') {
    // Process assistant messages
  } else if (message.type === 'result') {
    console.log('Review complete. Cost:', message.total_cost_usd);
  }
}
```

## Related

- [Overview](./01-overview.md)
- [TypeScript API](./02-typescript-api.md)
- [Agent Loop](./04-agent-loop.md)
- [Hooks](./07-hooks.md)
- [Permissions](./05-permissions.md)
