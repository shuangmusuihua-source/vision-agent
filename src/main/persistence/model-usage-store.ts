import { createHash } from 'crypto'
import { mkdir, readFile } from 'fs/promises'
import { dirname, join } from 'path'
import type { SDKResultMessage } from '@anthropic-ai/claude-agent-sdk'
import type { ModelUsageRange, ModelUsageSessionBreakdown } from '../../shared/types'
import {
  buildModelUsageDetail,
  buildModelUsageSummaries,
  type ModelUsageRun,
  type RecordedModelUsage,
} from '../model-usage-analytics'
import { getAppUserDataDir } from '../app-identity'
import { atomicWriteTextFile } from '../atomic-write'

const MAX_USAGE_RUNS = 20_000

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

/** Owns the existing model-usage.json ledger; no second persistence authority. */
export class ModelUsageStore {
  private runs: Map<string, ModelUsageRun> | null = null
  private readonly pending = new Map<string, ModelUsageRun>()
  private dirty = false
  private flushing: Promise<void> | null = null

  constructor(private readonly filePath: string) {}

  record(run: ModelUsageRun): void {
    this.pending.set(run.id, run)
    this.trim(this.pending)
    // Record one small event synchronously. Loading, batching and disk writes
    // happen asynchronously, so SDK stream delivery never waits on file I/O.
    void this.flush().catch(reportPersistenceError)
  }

  flush(): Promise<void> {
    if (!this.flushing) {
      this.flushing = this.persist().then(() => {
        this.flushing = null
        // A record can arrive after persist's last check but before this
        // continuation. Include it in this flush, including during shutdown.
        if (this.pending.size) return this.flush()
      }, (error) => {
        this.flushing = null
        throw error
      })
    }
    return this.flushing
  }

  async summaries(profileIds: string[]) {
    await this.flush()
    return buildModelUsageSummaries([...this.runs!.values()], profileIds)
  }

  async detail(profileId: string, range: ModelUsageRange) {
    await this.flush()
    return buildModelUsageDetail([...this.runs!.values()], profileId, range)
  }

  private trim(runs: Map<string, ModelUsageRun>): void {
    while (runs.size > MAX_USAGE_RUNS) runs.delete(runs.keys().next().value!)
  }

  private async load(): Promise<void> {
    if (this.runs) return
    let content: string
    try {
      content = await readFile(this.filePath, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      this.runs = new Map()
      return
    }
    const parsed = JSON.parse(content) as { runs: ModelUsageRun[] }
    if (!Array.isArray(parsed.runs)) throw new Error('用量记录格式无效，已保留原文件')
    const runs = new Map<string, ModelUsageRun>()
    for (const run of parsed.runs) {
      const sessionId = privateSessionId(run.source, run.sessionId)
      if (sessionId !== run.sessionId) this.dirty = true
      runs.set(run.id, { ...run, sessionId })
    }
    this.trim(runs)
    if (runs.size !== parsed.runs.length) this.dirty = true
    this.runs = runs
  }

  private async persist(): Promise<void> {
    await this.load()
    while (this.pending.size || this.dirty) {
      for (const [id, run] of this.pending) this.runs!.set(id, run)
      this.pending.clear()
      this.trim(this.runs!)
      // Keep the dirty snapshot after a failure so the next flush retries it.
      this.dirty = true
      await mkdir(dirname(this.filePath), { recursive: true })
      await atomicWriteTextFile(this.filePath, `${JSON.stringify({ runs: [...this.runs!.values()] })}\n`)
      this.dirty = false
    }
  }
}

function reportPersistenceError(error: unknown): void {
  // Analytics must never turn a successful Agent run into an execution error.
  console.error('[ModelUsage] failed to persist local analytics:', error)
}

const usageStore = new ModelUsageStore(join(getAppUserDataDir(), 'model-usage.json'))

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

    usageStore.record(run)
  } catch (error) {
    // Analytics is observational. A local persistence failure must never turn
    // a successful Agent run into an execution error.
    console.error('[ModelUsage] failed to record SDK usage:', error)
  }
}

export function getModelUsageSummaries(profileIds: string[]) {
  return usageStore.summaries(profileIds)
}

export function getModelUsageDetail(profileId: string, range: ModelUsageRange) {
  return usageStore.detail(profileId, range)
}

export function flushModelUsage(): Promise<void> {
  return usageStore.flush()
}
