import type { Options, HookCallbackMatcher, SettingSource } from '@anthropic-ai/claude-agent-sdk'
import { createRequire } from 'module'
import { existsSync } from 'fs'
import { join } from 'path'
import { getApiKey, getBaseUrl, getModel, getActiveProfile, getAuthorizedDirectories, getEnabledSkills } from './store'
import { getAppSkillsCwd } from './skill-init'

// ─── CLI path resolution (moved from agent-manager) ────────────────────

let _cachedCliPath: string | undefined | null = null

export function resolveClaudeCodeExecutable(): string | undefined {
  if (_cachedCliPath !== null) return _cachedCliPath

  const require = createRequire(import.meta.url)

  // Prefer platform-native binary
  try {
    const nativeBinary = require.resolve('@anthropic-ai/claude-agent-sdk-darwin-arm64/claude')
    const resolved = resolveAsarPath(nativeBinary)
    if (existsSync(resolved)) {
      _cachedCliPath = resolved
      return resolved
    }
  } catch { /* fall through */ }

  // Fall back to cli.js
  try {
    const cliJs = require.resolve('@anthropic-ai/claude-agent-sdk/cli.js')
    const resolved = resolveAsarPath(cliJs)
    if (existsSync(resolved)) {
      _cachedCliPath = resolved
      return resolved
    }
  } catch { /* fall through */ }

  _cachedCliPath = undefined
  return undefined
}

function resolveAsarPath(filePath: string): string {
  return filePath.replace('.asar/', '.asar.unpacked/').replace('.asar\\', '.asar.unpacked\\')
}

// ─── Options profile ───────────────────────────────────────────────────

export interface AgentOptionsProfile {
  /** Permission mode for the SDK subprocess. */
  permissionMode: 'default' | 'acceptEdits'
  /** Allowed tool names. */
  allowedTools: string[]
  /** Working directory. Defaults to getAppSkillsCwd(). */
  cwd?: string
  /** Explicit workspace CWD for session storage/skill discovery. Takes precedence over cwd for SDK execution dir. */
  workspaceCwd?: string
  /** Whether to include partial messages in the stream. */
  includePartialMessages?: boolean
  /** Setting sources for the SDK. */
  settingSources?: SettingSource[]
  /** Restrictive settings enforced by the embedding application. */
  managedSettings?: Options['managedSettings']
  /** Enabled skill IDs. Omit to skip skills config. */
  skills?: string[]
  /** System prompt append text. */
  systemPromptAppend?: string
  /** Hooks for the SDK subprocess. */
  hooks?: Partial<Record<string, HookCallbackMatcher[]>>
  /** canUseTool callback. */
  canUseTool?: Options['canUseTool']
  /** Extra env vars merged on top of the base env. */
  extraEnv?: Record<string, string | undefined>
  /** Prepend homebrew + /usr/local/bin paths to PATH. Default true. */
  prependUserBinPaths?: boolean
  /** When true, ANTHROPIC_BASE_URL is only set for custom API providers. */
  restrictiveBaseUrl?: boolean
  /** Session ID to resume. SDK loads conversation history from this session. */
  resume?: string
  /** Reasoning effort level. Lower = faster/cheaper, higher = deeper analysis. */
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  /** Maximum number of tool-use turns before stopping. */
  maxTurns?: number
  /** Maximum cost in USD before stopping. */
  maxBudgetUsd?: number
}

/**
 * Build SDK Options from a profile.
 *
 * Two adapters consume this interface:
 * - agent-manager (interactive: permissionMode=default, hooks, full canUseTool)
 * - cron-manager (headless: permissionMode=acceptEdits, no hooks, path-gating canUseTool)
 */
export function buildAgentOptions(profile: AgentOptionsProfile): Options {
  const apiKey = getApiKey()
  const model = getModel()
  const baseUrl = getBaseUrl()
  const activeProfile = getActiveProfile()
  const dirs = getAuthorizedDirectories()
  const workspaceCwd = dirs.length > 0 ? dirs[0] : process.cwd()
  const cliPath = resolveClaudeCodeExecutable()

  // Base environment — only forward whitelisted vars (not entire process.env)
  const env: Record<string, string | undefined> = {
    HOME: process.env.HOME,
    USER: process.env.USER,
    LANG: process.env.LANG,
    PATH: process.env.PATH,
  }

  // Prepend user-level bin paths so tools like pip/brew/npm are findable
  if (profile.prependUserBinPaths !== false) {
    const userBinPaths = [
      '/opt/homebrew/bin',
      '/opt/homebrew/sbin',
      '/usr/local/bin',
      '/usr/local/sbin',
      `${process.env.HOME}/.local/bin`,
    ].join(':')
    env.PATH = `${userBinPaths}:${process.env.PATH}`
    env.LC_ALL = process.env.LC_ALL
  }

  if (apiKey) {
    env.ANTHROPIC_API_KEY = apiKey
  }

  if (baseUrl) {
    if (profile.restrictiveBaseUrl) {
      // Only forward base URL for custom providers (cron safety)
      if (activeProfile?.apiProvider === 'custom') {
        env.ANTHROPIC_BASE_URL = baseUrl
      }
    } else {
      env.ANTHROPIC_BASE_URL = baseUrl
    }
  }

  // Merge caller-supplied extra env
  if (profile.extraEnv) {
    Object.assign(env, profile.extraEnv)
  }

  const effectiveCwd = profile.workspaceCwd ?? profile.cwd ?? getAppSkillsCwd()

  const options: Options = {
    model,
    cwd: effectiveCwd,
    allowedTools: profile.allowedTools,
    permissionMode: profile.permissionMode,
    env,
    ...(cliPath ? { pathToClaudeCodeExecutable: cliPath } : {}),
    settings: {
      autoMemoryDirectory: join(effectiveCwd, '.vision', 'memory'),
    },
    systemPrompt: {
      type: 'preset' as const,
      preset: 'claude_code' as const,
      ...(profile.systemPromptAppend ? { append: profile.systemPromptAppend } : {}),
    },
  }

  // Optional fields — only set when provided, avoids passing undefined
  if (profile.includePartialMessages !== undefined) {
    options.includePartialMessages = profile.includePartialMessages
  }
  if (profile.settingSources !== undefined) {
    options.settingSources = profile.settingSources
  }
  if (profile.managedSettings !== undefined) {
    options.managedSettings = profile.managedSettings
  }
  if (profile.skills !== undefined) {
    options.skills = profile.skills
  }
  if (profile.hooks !== undefined) {
    options.hooks = profile.hooks
  }
  if (profile.canUseTool !== undefined) {
    options.canUseTool = profile.canUseTool
  }
  if (profile.resume !== undefined) {
    options.resume = profile.resume
  }
  if (profile.effort !== undefined) {
    options.effort = profile.effort
  }
  if (profile.maxTurns !== undefined) {
    options.maxTurns = profile.maxTurns
  }
  if (profile.maxBudgetUsd !== undefined) {
    options.maxBudgetUsd = profile.maxBudgetUsd
  }

  return options
}
