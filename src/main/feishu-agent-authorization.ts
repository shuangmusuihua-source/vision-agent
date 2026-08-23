import type {
  HookCallback,
  PermissionResult,
  PreToolUseHookInput,
} from '@anthropic-ai/claude-agent-sdk'
import {
  getFeishuCapabilityForScope,
  type FeishuConnectorActionResult,
  type FeishuCapabilityId,
} from '../shared/feishu-types'
import type { PermissionRequestIPC } from '../shared/types'
import type { FeishuScopeCheckResult } from './feishu-connection'
import type { PermissionBeforeAllowResult } from './pending-interactions'

const MAX_SCOPE_COUNT = 32
const MAX_COMMAND_LENGTH = 4_096
const SCOPE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*(?::[A-Za-z0-9][A-Za-z0-9._-]*)+$/

export interface FeishuAgentScopeCheck {
  scopes: string[]
  capabilityIds: FeishuCapabilityId[]
  capabilityLabels: string[]
}

type FeishuAgentAuthorizationConnector = {
  checkScopes: (scopes: readonly string[]) => Promise<FeishuScopeCheckResult>
  authorizeScopes: (
    scopes: readonly string[],
    options: {
      signal?: AbortSignal
      openAuthorizationUrl: (url: string) => Promise<void>
    },
  ) => Promise<FeishuConnectorActionResult>
}

export type FeishuAgentAuthorizationHookDependencies = {
  isEnabled: () => boolean
  getConnector: () => FeishuAgentAuthorizationConnector
  requestPermission: (
    request: Omit<PermissionRequestIPC, 'id'>,
    signal: AbortSignal,
    beforeAllow: (signal: AbortSignal) => Promise<PermissionBeforeAllowResult>,
  ) => Promise<PermissionResult>
  openAuthorizationUrl: (url: string) => Promise<void>
}

function tokenizeLiteralCommand(command: string): string[] | null {
  if (
    command.length === 0
    || command.length > MAX_COMMAND_LENGTH
    || /[\0\r\n;&|><`$(){}\[\]*?!~\\]/.test(command)
  ) {
    return null
  }

  const tokens: string[] = []
  let token = ''
  let quote: "'" | '"' | null = null
  let tokenStarted = false

  for (const character of command) {
    if (quote) {
      if (character === quote) {
        quote = null
      } else {
        token += character
      }
      tokenStarted = true
      continue
    }

    if (character === "'" || character === '"') {
      quote = character
      tokenStarted = true
      continue
    }
    if (/\s/.test(character)) {
      if (tokenStarted) {
        tokens.push(token)
        token = ''
        tokenStarted = false
      }
      continue
    }
    token += character
    tokenStarted = true
  }

  if (quote) return null
  if (tokenStarted) tokens.push(token)
  return tokens
}

export function parseFeishuAgentScopeCheck(
  toolName: string,
  input: Record<string, unknown>,
): FeishuAgentScopeCheck | null {
  if (toolName !== 'Bash' || typeof input.command !== 'string') return null
  const rawCommand = input.command.trim()
  if (rawCommand.length > MAX_COMMAND_LENGTH) return null
  // Claude frequently appends this exact stderr merge to read-only CLI
  // commands. Strip only the terminal literal form before safe tokenization;
  // every other shell operator remains rejected by tokenizeLiteralCommand.
  const literalCommand = rawCommand.replace(/\s+2>&1$/, '').trimEnd()
  const tokens = tokenizeLiteralCommand(literalCommand)
  if (!tokens || tokens.length < 5) return null
  if (tokens[0] !== 'lark-cli' || tokens[1] !== 'auth' || tokens[2] !== 'check') return null

  let scopeValue: string | null = null
  let hasJsonFlag = false
  for (let index = 3; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (token === '--json' && !hasJsonFlag) {
      hasJsonFlag = true
      continue
    }
    if (token === '--scope' && scopeValue === null && index + 1 < tokens.length) {
      scopeValue = tokens[index + 1]
      index += 1
      continue
    }
    return null
  }
  if (!hasJsonFlag || !scopeValue) return null

  const scopes = [...new Set(scopeValue.split(/[\s,]+/).map(scope => scope.trim()).filter(Boolean))]
  if (
    scopes.length === 0
    || scopes.length > MAX_SCOPE_COUNT
    || scopes.some(scope => !SCOPE_PATTERN.test(scope))
  ) {
    return null
  }

  const capabilities = scopes.map(getFeishuCapabilityForScope)
  if (capabilities.some(capability => capability === undefined)) return null

  const knownCapabilities = capabilities.filter(
    (capability): capability is NonNullable<typeof capability> => Boolean(capability),
  )
  const capabilityIds = [...new Set(knownCapabilities.map(capability => capability.id))]
  const capabilityLabels = [...new Set(knownCapabilities.map(capability => capability.label))]

  return {
    scopes,
    capabilityIds,
    capabilityLabels,
  }
}

/**
 * Build the mandatory Feishu authorization gate at the SDK PreToolUse layer.
 * Unlike canUseTool, PreToolUse also runs while the session is in automatic
 * approval mode, so a missing Scope cannot silently fall through to the CLI.
 */
export function createFeishuAgentAuthorizationHook(
  dependencies: FeishuAgentAuthorizationHookDependencies,
): HookCallback {
  return async (input, _toolUseId, options) => {
    const { tool_name, tool_input } = input as PreToolUseHookInput
    const normalizedInput = (tool_input || {}) as Record<string, unknown>
    const scopeCheck = dependencies.isEnabled()
      ? parseFeishuAgentScopeCheck(tool_name, normalizedInput)
      : null
    if (!scopeCheck) return {}

    const connector = dependencies.getConnector()
    const scopeStatus = await connector.checkScopes(scopeCheck.scopes)
    if (!scopeStatus.success) {
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: scopeStatus.error,
        },
      }
    }
    if (scopeStatus.missingScopes.length === 0) {
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'allow',
          updatedInput: normalizedInput,
        },
      }
    }

    const result = await dependencies.requestPermission(
      {
        toolName: tool_name,
        input: normalizedInput,
        title: '需要飞书授权',
        displayName: '飞书连接器',
        description: `继续当前任务需要${scopeCheck.capabilityLabels.join('、')}权限。`,
        connectorAuthorization: {
          connector: 'feishu',
          capabilityIds: scopeCheck.capabilityIds,
          capabilityLabels: scopeCheck.capabilityLabels,
          scopes: scopeStatus.missingScopes,
        },
      },
      options.signal,
      async (authorizationSignal) => {
        const authorization = await connector.authorizeScopes(scopeCheck.scopes, {
          signal: authorizationSignal,
          openAuthorizationUrl: dependencies.openAuthorizationUrl,
        })
        return authorization.success
          ? { success: true }
          : { success: false, message: authorization.error || '飞书授权未完成' }
      },
    )

    return result.behavior === 'allow'
      ? {
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'allow',
            updatedInput: normalizedInput,
          },
        }
      : {
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason: result.message,
          },
        }
  }
}
