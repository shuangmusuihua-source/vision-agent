# Skills System

Skills are filesystem-based capabilities that extend the agent's behavior. They are defined as Markdown files in the `.claude/skills/` directory and discovered automatically.

## Overview

Skills provide a way to package domain knowledge, instructions, and tool configurations that the agent can use. Unlike custom tools or MCP servers, skills are declarative and filesystem-based.

## Skill Structure

Skills are stored in the `.claude/skills/` directory, each in its own subdirectory with a `SKILL.md` file:

```
.claude/
  skills/
    code-review/
      SKILL.md
    security-audit/
      SKILL.md
    documentation/
      SKILL.md
```

### SKILL.md Format

Each `SKILL.md` file contains instructions for the agent in Markdown format, optionally with YAML frontmatter:

```markdown
---
name: Code Review
description: Perform a thorough code review
allowed-tools:
  - Read
  - Glob
  - Grep
---

# Code Review Skill

You are a code reviewer. When invoked:

1. Read the files that need review
2. Analyze for:
   - Bug risks
   - Security vulnerabilities
   - Performance issues
   - Code style violations
3. Provide a structured review with severity ratings

## Output Format

For each finding:
- **File**: Path to the file
- **Line**: Line number range
- **Severity**: Critical / High / Medium / Low
- **Description**: What the issue is
- **Suggestion**: How to fix it
```

> **Important:** The `allowed-tools` frontmatter field in `SKILL.md` does NOT apply in the SDK. Tool availability is controlled by the `allowedTools` and `disallowedTools` options on `query()`.

## Configuration

### Enable All Skills

Set `skills: 'all'` to auto-discover and enable all skills from the configured `settingSources`:

```typescript
import { query } from '@anthropic-ai/claude-agent-sdk';

const q = query({
  prompt: 'Review the authentication module',
  options: {
    skills: 'all',
    cwd: '/path/to/project',
  },
});
```

### Enable Specific Skills

Pass an array of skill names to enable only specific skills:

```typescript
const q = query({
  prompt: 'Review the code for security issues',
  options: {
    skills: ['security-audit', 'code-review'],
    cwd: '/path/to/project',
  },
});
```

### Disable Skills

Set `skills` to an empty array or omit it to disable all skills:

```typescript
const q = query({
  prompt: 'Quick question about the codebase',
  options: {
    skills: [],  // No skills enabled
  },
});
```

## Setting Sources

Skills are loaded from `settingSources`, which determine where the SDK looks for skill definitions:

| Source | Path | Description |
|--------|------|-------------|
| `user` | `~/.claude/skills/` | User-level skills available in all projects |
| `project` | `.claude/skills/` | Project-level skills specific to the current project |

```typescript
const q = query({
  prompt: 'Analyze the codebase',
  options: {
    skills: 'all',
    settingSources: ['user', 'project'],
  },
});
```

## How Skills Work

1. **Discovery**: When `skills` is configured, the SDK scans the skill directories from `settingSources`
2. **Loading**: Each `SKILL.md` file is read and parsed
3. **Injection**: Skill instructions are injected into the agent's context as part of the system prompt or skill definitions
4. **Invocation**: The agent can use the `Skill` tool to invoke a skill, or skills may be automatically triggered based on the prompt

## Using the Skill Tool

The agent uses the built-in `Skill` tool to invoke skills:

```typescript
// The agent automatically decides when to use skills based on the prompt
const q = query({
  prompt: 'Do a security audit of the login flow',
  options: {
    skills: 'all',
  },
});
```

## Skills in Subagents

Subagents can have their own skill configuration:

```typescript
const q = query({
  prompt: 'Analyze the codebase',
  options: {
    agents: [
      {
        description: 'Security auditor',
        prompt: 'You are a security expert.',
        skills: ['security-audit'],  // Only the security skill
        tools: ['Read', 'Glob', 'Grep'],
      },
    ],
    allowedTools: ['Agent'],
  },
});
```

## No Programmatic API

> **Note:** There is no programmatic API for registering skills at runtime. Skills must be defined as filesystem files in the `.claude/skills/` directory. This is by design — skills are meant to be version-controlled and shared alongside the project.

## Skill Best Practices

### Writing Effective Skills

1. **Be specific** — Provide clear, actionable instructions
2. **Include examples** — Show the expected output format
3. **Scope appropriately** — Each skill should focus on one domain
4. **Use frontmatter** — Include `name` and `description` for discoverability

### Example: Documentation Skill

```markdown
---
name: API Documentation
description: Generate API documentation from code
---

# API Documentation Skill

When invoked, generate comprehensive API documentation:

1. **Scan** all exported functions, classes, and types
2. **Extract** JSDoc/TSDoc comments and type signatures
3. **Generate** Markdown documentation with:
   - Function signatures with parameter descriptions
   - Return types and descriptions
   - Usage examples
   - Type definitions

## Output Format

Generate a single Markdown file with sections for each module.
```

### Example: Testing Skill

```markdown
---
name: Test Generator
description: Generate unit tests for the specified code
---

# Test Generator Skill

When invoked, generate comprehensive unit tests:

1. **Read** the target file
2. **Identify** all exported functions and classes
3. **Generate** tests covering:
   - Happy path scenarios
   - Edge cases
   - Error conditions
4. **Use** the project's test framework (check package.json)

## Guidelines

- Aim for >80% code coverage
- Use descriptive test names
- Include setup/teardown when needed
- Mock external dependencies
```

## Related

- [Overview](./01-overview.md)
- [TypeScript API](./02-typescript-api.md)
- [Subagents](./09-subagents.md)
- [Custom Tools](./12-custom-tools.md)
