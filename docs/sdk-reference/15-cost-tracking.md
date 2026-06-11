# Cost and Usage Tracking

The SDK provides cost and token usage tracking for agent queries. This is essential for monitoring spending and optimizing resource usage.

## Total Cost

The `total_cost_usd` field on `SDKResultMessage` provides a client-side estimate of the total cost for the query:

```typescript
import { query } from '@anthropic-ai/claude-agent-sdk';

const q = query({
  prompt: 'Analyze the codebase',
  options: {},
});

for await (const message of q) {
  if (message.type === 'result') {
    console.log(`Total cost: $${message.total_cost_usd.toFixed(4)}`);
  }
}
```

> **Note:** `total_cost_usd` is a client-side estimate. It may not exactly match the billed amount due to rounding, cache pricing, and other factors.

## Per-Step Usage

Each `SDKAssistantMessage` includes usage information in `message.usage`:

```typescript
for await (const message of q) {
  if (message.type === 'assistant') {
    const usage = message.message.usage;
    console.log('Step usage:', {
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      cacheCreation: usage.cache_creation_input_tokens,
      cacheRead: usage.cache_read_input_tokens,
    });
  }
}
```

### Usage Fields

| Field | Type | Description |
|-------|------|-------------|
| `input_tokens` | `number` | Input tokens for this step |
| `output_tokens` | `number` | Output tokens for this step |
| `cache_creation_input_tokens` | `number` | Tokens written to the cache |
| `cache_read_input_tokens` | `number` | Tokens read from the cache |

## Per-Model Breakdown

The `modelUsage` field on `SDKResultMessage` provides a per-model cost breakdown:

```typescript
for await (const message of q) {
  if (message.type === 'result') {
    if (message.modelUsage) {
      for (const [model, usage] of Object.entries(message.modelUsage)) {
        console.log(`Model ${model}:`, usage);
      }
    }
  }
}
```

This is especially useful when subagents use different models:

```typescript
// Example output:
// Model claude-sonnet-4-20250514: { input_tokens: 50000, output_tokens: 3000, cost_usd: 0.42 }
// Model claude-haiku-3-5-20241022: { input_tokens: 20000, output_tokens: 1000, cost_usd: 0.05 }
```

## Deduplicating Parallel Tool Calls

When the agent makes multiple tool calls in parallel within a single turn, the usage is reported once at the message level. To avoid double-counting:

1. **Track by message ID** — Use the message ID as a unique key
2. **Skip duplicate IDs** — If you see the same message ID twice, skip it

```typescript
const seenMessageIds = new Set<string>();
let totalInputTokens = 0;
let totalOutputTokens = 0;

for await (const message of q) {
  if (message.type === 'assistant') {
    const msgId = message.message.id;
    if (seenMessageIds.has(msgId)) continue;  // Skip duplicates
    seenMessageIds.add(msgId);

    const usage = message.message.usage;
    totalInputTokens += usage.input_tokens;
    totalOutputTokens += usage.output_tokens;
  }
}

console.log(`Total: ${totalInputTokens} input, ${totalOutputTokens} output tokens`);
```

## Cache Tokens

The SDK supports prompt caching, which can significantly reduce costs for repeated context:

| Token Type | Description | Pricing Impact |
|------------|-------------|----------------|
| `cache_creation_input_tokens` | Tokens written to cache for the first time | Higher than base input price |
| `cache_read_input_tokens` | Tokens read from cache on subsequent requests | Lower than base input price |

```typescript
for await (const message of q) {
  if (message.type === 'assistant') {
    const usage = message.message.usage;
    console.log('Cache stats:', {
      created: usage.cache_creation_input_tokens,
      read: usage.cache_read_input_tokens,
      savings: usage.cache_read_input_tokens > 0
        ? `${((usage.cache_read_input_tokens / (usage.input_tokens || 1)) * 100).toFixed(1)}% from cache`
        : 'None',
    });
  }
}
```

### 1-Hour Cache TTL

By default, the cache TTL is 5 minutes. To enable 1-hour cache TTL, set the `ENABLE_PROMPT_CACHING_1H` environment variable:

```typescript
const q = query({
  prompt: 'Long-running analysis',
  options: {
    env: {
      ENABLE_PROMPT_CACHING_1H: '1',
    },
  },
});
```

Or set it in the process environment:

```bash
ENABLE_PROMPT_CACHING_1H=1 node your-app.js
```

> **Note:** 1-hour caching keeps entries in the cache longer, which may increase cache storage costs but reduces the frequency of cache misses.

## Budget Limits

Use `maxBudgetUsd` to set a spending limit for a query:

```typescript
const q = query({
  prompt: 'Analyze the codebase',
  options: {
    maxBudgetUsd: 2.00,  // Stop when cost exceeds $2.00
  },
});
```

When the budget is exceeded, the agent stops and emits a `ResultMessage` with the appropriate stop reason.

## Cost Tracking Utility

Here is a utility class for tracking costs across multiple queries:

```typescript
class CostTracker {
  private totalCost = 0;
  private totalInputTokens = 0;
  private totalOutputTokens = 0;
  private totalCacheCreated = 0;
  private totalCacheRead = 0;
  private seenMessages = new Set<string>();

  processMessage(message: SDKMessage): void {
    if (message.type === 'assistant') {
      const msgId = message.message.id;
      if (this.seenMessages.has(msgId)) return;
      this.seenMessages.add(msgId);

      const usage = message.message.usage;
      this.totalInputTokens += usage.input_tokens;
      this.totalOutputTokens += usage.output_tokens;
      this.totalCacheCreated += usage.cache_creation_input_tokens;
      this.totalCacheRead += usage.cache_read_input_tokens;
    }

    if (message.type === 'result') {
      this.totalCost = message.total_cost_usd;
    }
  }

  getReport(): string {
    return [
      '=== Cost Report ===',
      `Total Cost: $${this.totalCost.toFixed(4)}`,
      `Input Tokens: ${this.totalInputTokens.toLocaleString()}`,
      `Output Tokens: ${this.totalOutputTokens.toLocaleString()}`,
      `Cache Created: ${this.totalCacheCreated.toLocaleString()} tokens`,
      `Cache Read: ${this.totalCacheRead.toLocaleString()} tokens`,
      `Cache Hit Rate: ${this.totalInputTokens > 0
        ? ((this.totalCacheRead / this.totalInputTokens) * 100).toFixed(1)
        : 0}%`,
    ].join('\n');
  }
}

// Usage
const tracker = new CostTracker();

const q = query({
  prompt: 'Refactor the codebase',
  options: {},
});

for await (const message of q) {
  tracker.processMessage(message);
}

console.log(tracker.getReport());
```

## Complete Example: Budget-Aware Query

```typescript
import { query } from '@anthropic-ai/claude-agent-sdk';

async function budgetAwareQuery(prompt: string, maxBudget: number): Promise<void> {
  let currentCost = 0;

  const q = query({
    prompt,
    options: {
      maxBudgetUsd: maxBudget,
    },
  });

  const seenMessages = new Set<string>();

  for await (const message of q) {
    if (message.type === 'assistant') {
      const msgId = message.message.id;
      if (!seenMessages.has(msgId)) {
        seenMessages.add(msgId);
        const usage = message.message.usage;
        console.log(
          `Step: ${usage.input_tokens} in, ${usage.output_tokens} out, ` +
          `${usage.cache_read_input_tokens} cached`,
        );
      }
    }

    if (message.type === 'result') {
      currentCost = message.total_cost_usd;
      console.log(`\nTotal cost: $${currentCost.toFixed(4)} / $${maxBudget.toFixed(2)} budget`);

      if (message.modelUsage) {
        console.log('\nPer-model breakdown:');
        for (const [model, usage] of Object.entries(message.modelUsage)) {
          console.log(`  ${model}: ${JSON.stringify(usage)}`);
        }
      }

      const budgetUsed = (currentCost / maxBudget) * 100;
      console.log(`Budget used: ${budgetUsed.toFixed(1)}%`);
    }
  }
}

await budgetAwareQuery('Comprehensive codebase analysis', 5.00);
```

## Related

- [Overview](./01-overview.md)
- [TypeScript API](./02-typescript-api.md)
- [Sessions](./03-sessions.md)
- [Agent Loop](./04-agent-loop.md)
- [Session Storage](./14-session-storage.md)
