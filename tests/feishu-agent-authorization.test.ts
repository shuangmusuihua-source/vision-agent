import { describe, expect, it, vi } from 'vitest'
import {
  createFeishuAgentAuthorizationHook,
  parseFeishuAgentScopeCheck,
} from '../src/main/feishu-agent-authorization'

describe('parseFeishuAgentScopeCheck', () => {
  it('accepts only the literal structured scope preflight used by the Feishu Skill', () => {
    expect(parseFeishuAgentScopeCheck('Bash', {
      command: "lark-cli auth check --scope 'calendar:calendar.event:read calendar:calendar:readonly' --json",
    })).toEqual({
      scopes: [
        'calendar:calendar.event:read',
        'calendar:calendar:readonly',
      ],
      capabilityIds: ['calendar'],
      capabilityLabels: ['日历'],
    })

    expect(parseFeishuAgentScopeCheck('Bash', {
      command: 'lark-cli auth check --json --scope "docx:document:readonly search:docs:read"',
    })).toEqual({
      scopes: ['docx:document:readonly', 'search:docs:read'],
      capabilityIds: ['docs', 'drive'],
      capabilityLabels: ['云文档', '云空间'],
    })

    // Regression: this is the exact command emitted in an automatic-mode
    // session where canUseTool was bypassed. PreToolUse must still recognize
    // it and route it to the in-chat connector authorization card.
    expect(parseFeishuAgentScopeCheck('Bash', {
      command: "lark-cli auth check --scope 'okr:okr.period:readonly' --json 2>&1",
      description: '检查 OKR 读取权限',
    })).toEqual({
      scopes: ['okr:okr.period:readonly'],
      capabilityIds: ['okr'],
      capabilityLabels: ['OKR'],
    })
  })

  it('rejects shell composition, command substitution, unknown scopes, and broad login requests', () => {
    const rejectedCommands = [
      "lark-cli auth check --scope 'calendar:calendar.event:read' --json; open https://example.com",
      "lark-cli auth check --scope 'calendar:calendar.event:read' --json 2>&1; open https://example.com",
      "lark-cli auth check --scope 'calendar:calendar.event:read' --json > /tmp/result.json",
      "lark-cli auth check --scope 'calendar:$(whoami)' --json",
      "lark-cli auth check --scope 'unknown:everything' --json",
      'lark-cli auth login --domain all --json',
      "lark-cli auth check --scope 'calendar:calendar.event:read'",
    ]

    for (const command of rejectedCommands) {
      expect(parseFeishuAgentScopeCheck('Bash', { command })).toBeNull()
    }
  })

  it('does not intercept non-Bash tools or non-string commands', () => {
    expect(parseFeishuAgentScopeCheck('Read', {
      command: "lark-cli auth check --scope 'calendar:calendar.event:read' --json",
    })).toBeNull()
    expect(parseFeishuAgentScopeCheck('Bash', { command: 42 })).toBeNull()
  })

  it('requests the in-chat authorization card from PreToolUse in automatic mode', async () => {
    const checkScopes = vi.fn().mockResolvedValue({
      success: true,
      grantedScopes: [],
      missingScopes: ['okr:okr.period:readonly'],
    })
    const authorizeScopes = vi.fn().mockResolvedValue({ success: true })
    const requestPermission = vi.fn(async (request, _signal, beforeAllow) => {
      expect(request.connectorAuthorization).toEqual({
        connector: 'feishu',
        capabilityIds: ['okr'],
        capabilityLabels: ['OKR'],
        scopes: ['okr:okr.period:readonly'],
      })
      await expect(beforeAllow(new AbortController().signal)).resolves.toEqual({ success: true })
      return { behavior: 'allow' as const, updatedInput: request.input }
    })
    const hook = createFeishuAgentAuthorizationHook({
      isEnabled: () => true,
      getConnector: () => ({ checkScopes, authorizeScopes }),
      requestPermission,
      openAuthorizationUrl: vi.fn().mockResolvedValue(undefined),
    })
    const input = {
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: {
        command: "lark-cli auth check --scope 'okr:okr.period:readonly' --json 2>&1",
        description: '检查 OKR 读取权限',
      },
      tool_use_id: 'tool-okr',
      permission_mode: 'auto',
    }

    await expect(hook(input as never, 'tool-okr', {
      signal: new AbortController().signal,
    })).resolves.toMatchObject({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
      },
    })
    expect(checkScopes).toHaveBeenCalledWith(['okr:okr.period:readonly'])
    expect(requestPermission).toHaveBeenCalledOnce()
    expect(authorizeScopes).toHaveBeenCalledWith(
      ['okr:okr.period:readonly'],
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
  })
})
