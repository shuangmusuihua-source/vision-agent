import Store from 'electron-store'
import { createHash } from 'crypto'
import type { SDKResultMessage } from '@anthropic-ai/claude-agent-sdk'
import type { ModelUsageRange, ModelUsageSessionBreakdown } from '../../shared/types'
import {
  buildModelUsageDetail,
  buildModelUsageSummaries,
  type ModelUsageRun,
  type RecordedModelUsage,
} from '../model-usage-analytics'
import { getAppUserDataDir } from '../app-identity'

const MAX_USAGE_RUNS = 20_000

type ModelUsageLedger = {
  runs: ModelUsageRun[]
}

export type ModelUsageProfileIdentity = {
  id: string
  name: string
  model: string
}

export type RecordModelUsageOptions = {
  result: SDKResultMessage
  profile: ModelUsageProfileIdentity | null
  source: ModelUsageSessionBreakdown['source']
  sessionId: string
  sessionTitle: string
  workspaceName: string
  skillIds?: Iterable<string>
  recordedAt?: number
}

const usageStore = new Store<ModelUsageLedger>({
  cwd: getAppUserDataDir(),
  name: 'model-usage',
  defaults: { runs: [] },
})

function finiteNonNegative(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

function toRecordedModels(result: SDKResultMessage): RecordedModelUsage[] {
  return Object.entries(result.modelUsage || {}).map(([modelId, usage]) => ({
    modelId,
    inputTokens: finiteNonNegative(usage.inputTokens),
    outputTokens: finiteNonNegative(usage.outputTokens),
    cacheReadInputTokens: finiteNonNegative(usage.cacheReadInputTokens),
    cacheCreationInputTokens: finiteNonNegative(usage.cacheCreationInputTokens),
    thinkingTokens: finiteNonNegative(usage.thinkingTokens),
    costUSD: finiteNonNegative(usage.costUSD),
  }))
}

function privateSessionId(source: ModelUsageRun['source'], sessionId: string): string {
  if (source !== 'inline-rewrite' || sessionId.startsWith('file:sha256:')) return sessionId
  return `file:sha256:${createHash('sha256').update(sessionId).digest('hex')}`
}

function getRuns(): ModelUsageRun[] {
  try {
    const runs = usageStore.get('runs')
    if (!Array.isArray(runs)) return []
    let migrated = false
    const sanitized = runs.map((run) => {
      const sessionId = privateSessionId(run.source, run.sessionId)
      if (sessionId === run.sessionId) return run
      migrated = true
      return { ...run, sessionId }
    })
    if (migrated) usageStore.set('runs', sanitized)
    return sanitized
  } catch (error) {
    console.error('[ModelUsage] failed to read local analytics:', error)
    return []
  }
}

export function recordModelUsage(options: RecordModelUsageOptions): void {
  if (!options.profile) return
  try {
    const run: ModelUsageRun = {
      id: options.result.uuid,
      recordedAt: options.recordedAt ?? Date.now(),
      profileId: options.profile.id,
      profileName: options.profile.name,
      configuredModel: options.profile.model,
      source: options.source,
      sessionId: privateSessionId(options.source, options.sessionId),
      sessionTitle: options.sessionTitle,
      workspaceName: options.workspaceName,
      skillIds: [...new Set(options.skillIds || [])].filter(Boolean),
      durationMs: finiteNonNegative(options.result.duration_ms),
      numTurns: finiteNonNegative(options.result.num_turns),
      totalCostUSD: finiteNonNegative(options.result.total_cost_usd),
      models: toRecordedModels(options.result),
    }

    const runs = getRuns()
    const existingIndex = runs.findIndex((item) => item.id === run.id)
    if (existingIndex >= 0) runs[existingIndex] = run
    else runs.push(run)
    if (runs.length > MAX_USAGE_RUNS) runs.splice(0, runs.length - MAX_USAGE_RUNS)
    usageStore.set('runs', runs)
  } catch (error) {
    // Analytics is observational. A local persistence failure must never turn
    // a successful Agent run into an execution error.
    console.error('[ModelUsage] failed to record SDK usage:', error)
  }
}

export function getModelUsageSummaries(profileIds: string[]) {
  return buildModelUsageSummaries(getRuns(), profileIds)
}

export function getModelUsageDetail(profileId: string, range: ModelUsageRange) {
  return buildModelUsageDetail(getRuns(), profileId, range)
}

// Remove paths from ledgers written by earlier versions on first load.
getRuns()
