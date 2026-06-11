# Handle Approvals and User Input

The SDK provides mechanisms for handling tool approvals and the `AskUserQuestion` tool, which allows the agent to request input from the user at runtime.

## Overview

There are two types of user interaction:

1. **Tool approval** — The agent wants to use a tool that requires permission
2. **AskUserQuestion** — The agent explicitly asks the user a question

Both interactions are handled through the `canUseTool` callback.

## Tool Approvals via canUseTool

When the agent requests to use a tool that requires approval, the `canUseTool` callback is invoked:

```typescript
const q = query({
  prompt: 'Fix the failing tests',
  options: {
    permissionMode: 'default',
    canUseTool: async (toolName, input, opts) => {
      // Display the request to the user and wait for their response
      const approved = await showApprovalDialog(toolName, input);
      if (approved) {
        return { behavior: 'allow' };
      }
      return { behavior: 'deny', message: 'User denied this operation' };
    },
  },
});
```

### Permission Request Data

The `canUseTool` callback receives rich context about the permission request:

| Field | Type | Description |
|-------|------|-------------|
| `toolName` | `string` | Name of the tool being called |
| `input` | `Record<string, unknown>` | Tool input parameters |
| `opts.signal` | `AbortSignal` | Signal for cancellation |
| `opts.suggestions` | `string[]` | Suggested persistent permission rules |
| `opts.blockedPath` | `string?` | Path that was blocked (if any) |
| `opts.decisionReason` | `string?` | Why this check was triggered |
| `opts.toolUseID` | `string` | Unique ID for this tool use |
| `opts.agentID` | `string?` | ID of the calling agent (for subagents) |

### Suggestions

The `suggestions` field contains suggested permission rules that, if applied, would auto-approve this type of tool call in the future. This enables building "always allow" UI patterns:

```typescript
canUseTool: async (toolName, input, opts) => {
  // Show dialog with option to remember the decision
  const result = await showDialog({
    tool: toolName,
    input,
    suggestions: opts.suggestions,
  });

  if (result.approved) {
    const response: AllowResponse = { behavior: 'allow' };

    // If user chose "always allow", save the suggestion as a persistent rule
    if (result.alwaysAllow && opts.suggestions.length > 0) {
      response.updatedPermissions = opts.suggestions.map(s => ({
        rule: s,
        behavior: 'allow' as const,
      }));
    }

    return response;
  }

  return { behavior: 'deny', message: result.reason || 'Denied by user' };
},
```

## AskUserQuestion Tool

The `AskUserQuestion` tool allows the agent to explicitly ask the user questions during execution. It is also handled through the `canUseTool` callback.

### Detecting AskUserQuestion

Check `toolName === 'AskUserQuestion'` to identify when the agent is asking a question rather than requesting tool approval:

```typescript
canUseTool: async (toolName, input, opts) => {
  if (toolName === 'AskUserQuestion') {
    // Handle the question
    return await handleUserQuestion(input);
  }

  // Handle regular tool approval
  return await handleToolApproval(toolName, input, opts);
},
```

### Question Structure

The `AskUserQuestion` input contains a `questions` array:

```typescript
interface AskUserQuestionInput {
  questions: Array<{
    question: string;             // The question text
    header: string;               // Section header for display
    options?: Array<{             // Available choices
      label: string;              // Option label (used as answer value)
      description?: string;       // Optional description
      preview?: string;           // Optional preview content
    }>;
    multiSelect?: boolean;        // Allow multiple selections
  }>;
}
```

### Responding to Questions

Return `updatedInput` with the answers:

```typescript
canUseTool: async (toolName, input, opts) => {
  if (toolName === 'AskUserQuestion') {
    const questions = input.questions as Array<{
      question: string;
      header: string;
      options?: Array<{ label: string; description?: string; preview?: string }>;
      multiSelect?: boolean;
    }>;

    // Display questions to user and collect answers
    const answers: Record<string, string> = {};
    for (const q of questions) {
      if (q.options && q.options.length > 0) {
        // Multiple choice question
        const selected = await showOptionsDialog(q.header, q.question, q.options);
        answers[q.question] = selected;
      } else {
        // Free-text question
        const response = await showTextInputDialog(q.header, q.question);
        answers[q.question] = response;
      }
    }

    return {
      behavior: 'allow',
      updatedInput: {
        questions,
        answers,
      },
    };
  }

  return { behavior: 'allow' };
},
```

### Preview Format

The `toolConfig.askUserQuestion.previewFormat` option controls how preview content is rendered:

```typescript
const q = query({
  prompt: 'Help me choose a design',
  options: {
    toolConfig: {
      askUserQuestion: {
        previewFormat: 'markdown',  // 'markdown' | 'html'
      },
    },
  },
});
```

| Format | Description |
|--------|-------------|
| `'markdown'` | Render preview content as Markdown |
| `'html'` | Render preview content as HTML |

## Complete Example: Full Approval + Question Handler

```typescript
import { query } from '@anthropic-ai/claude-agent-sdk';

// In-memory permission store for "always allow" rules
const permissionRules: Map<string, 'allow' | 'deny'> = new Map();

const q = query({
  prompt: 'Review and improve the codebase',
  options: {
    permissionMode: 'default',
    allowedTools: ['Read', 'Glob', 'Grep'],

    canUseTool: async (toolName, input, opts) => {
      // Handle AskUserQuestion
      if (toolName === 'AskUserQuestion') {
        const questions = input.questions as Array<{
          question: string;
          header: string;
          options?: Array<{ label: string; description?: string }>;
        }>;

        const answers: Record<string, string> = {};
        for (const q of questions) {
          console.log(`\n[${q.header}]`);
          console.log(q.question);
          if (q.options) {
            q.options.forEach((opt, i) => {
              console.log(`  ${i + 1}. ${opt.label}${opt.description ? ` - ${opt.description}` : ''}`);
            });
            const choice = await getUserChoice(q.options.length);
            answers[q.question] = q.options[choice].label;
          } else {
            const response = await getUserInput();
            answers[q.question] = response;
          }
        }

        return {
          behavior: 'allow',
          updatedInput: { questions, answers },
        };
      }

      // Check stored permission rules
      const ruleKey = `${toolName}:${JSON.stringify(input)}`;
      const storedRule = permissionRules.get(ruleKey);
      if (storedRule === 'allow') return { behavior: 'allow' };
      if (storedRule === 'deny') {
        return { behavior: 'deny', message: 'Previously denied' };
      }

      // Show approval dialog
      console.log(`\nTool Approval Request: ${toolName}`);
      console.log('Input:', JSON.stringify(input, null, 2));

      const decision = await getApprovalDecision();

      if (decision === 'allow-always' && opts.suggestions.length > 0) {
        return {
          behavior: 'allow',
          updatedPermissions: opts.suggestions.map(s => ({
            rule: s,
            behavior: 'allow' as const,
          })),
        };
      }

      if (decision === 'allow') return { behavior: 'allow' };

      return {
        behavior: 'deny',
        message: 'User denied this operation',
      };
    },
  },
});

for await (const message of q) {
  if (message.type === 'result') {
    console.log('Completed. Cost:', message.total_cost_usd);
  }
}
```

## Related

- [Overview](./01-overview.md)
- [Permissions](./05-permissions.md)
- [Hooks](./07-hooks.md)
- [Subagents](./09-subagents.md)
