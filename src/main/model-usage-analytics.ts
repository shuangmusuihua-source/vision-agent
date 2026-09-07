import type {
  ModelUsageDailyPoint,
  ModelUsageDetail,
  ModelUsageModelBreakdown,
  ModelUsageProfileSummary,
  ModelUsageRange,
  ModelUsageSessionBreakdown,
  ModelUsageSkillBreakdown,
  ModelUsageTotals,
} from '../shared/types'

export type RecordedModelUsage = {
  modelId: string
  inputTokens: number
  outputTokens: number
  cacheReadInputTokens: number
  cacheCreationInputTokens: number
  thinkingTokens: number
  costUSD: number
}

export type ModelUsageRun = {
  id: string
  recordedAt: number
  profileId: string
  profileName: string
  configuredModel: string
  source: ModelUsageSessionBreakdown['source']
  sessionId: string
  sessionTitle: string
  workspaceName: string
  skillIds: string[]
  durationMs: number
  numTurns: number
  totalCostUSD: number
  models: RecordedModelUsage[]
}

const RANGE_DAYS: Record<Exclude<ModelUsageRange, 'all'>, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
}

export function emptyModelUsageTotals(): ModelUsageTotals {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    thinkingTokens: 0,
    totalTokens: 0,
    requestCount: 0,
    sessionCount: 0,
    costUSD: 0,
  }
}

function tokensForModel(model: RecordedModelUsage): number {
  return model.inputTokens
    + model.outputTokens
    + model.cacheReadInputTokens
    + model.cacheCreationInputTokens
}

function totalsForRun(run: ModelUsageRun): Omit<ModelUsageTotals, 'requestCount' | 'sessionCount'> {
  const totals = emptyModelUsageTotals()
  for (const model of run.models) {
    totals.inputTokens += model.inputTokens
    totals.outputTokens += model.outputTokens
    totals.cacheReadInputTokens += model.cacheReadInputTokens
    totals.cacheCreationInputTokens += model.cacheCreationInputTokens
    totals.thinkingTokens += model.thinkingTokens
    totals.totalTokens += tokensForModel(model)
  }
  totals.costUSD = run.totalCostUSD
  return totals
}

function startForRange(range: ModelUsageRange, now: number): number | null {
  if (range === 'all') return null
  return now - RANGE_DAYS[range] * 24 * 60 * 60 * 1000
}

function filterRuns(runs: ModelUsageRun[], profileId: string, range: ModelUsageRange, now: number): ModelUsageRun[] {
  const start = startForRange(range, now)
  return runs.filter((run) => (
    run.profileId === profileId
    && (start === null || run.recordedAt >= start)
  ))
}

function dateKey(timestamp: number): string {
  const date = new Date(timestamp)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function aggregateTotals(runs: ModelUsageRun[]): ModelUsageTotals {
  const totals = emptyModelUsageTotals()
  const sessionIds = new Set<string>()
  for (const run of runs) {
    const runTotals = totalsForRun(run)
    totals.inputTokens += runTotals.inputTokens
    totals.outputTokens += runTotals.outputTokens
    totals.cacheReadInputTokens += runTotals.cacheReadInputTokens
    totals.cacheCreationInputTokens += runTotals.cacheCreationInputTokens
    totals.thinkingTokens += runTotals.thinkingTokens
    totals.totalTokens += runTotals.totalTokens
    totals.costUSD += runTotals.costUSD
    totals.requestCount += 1
    sessionIds.add(`${run.source}:${run.sessionId}`)
  }
  totals.sessionCount = sessionIds.size
  return totals
}

function aggregateDaily(runs: ModelUsageRun[]): ModelUsageDailyPoint[] {
  const points = new Map<string, ModelUsageDailyPoint>()
  for (const run of runs) {
    const key = dateKey(run.recordedAt)
    const point = points.get(key) || { date: key, totalTokens: 0, requestCount: 0, costUSD: 0 }
    const totals = totalsForRun(run)
    point.totalTokens += totals.totalTokens
    point.requestCount += 1
    point.costUSD += totals.costUSD
    points.set(key, point)
  }
  return [...points.values()].sort((left, right) => left.date.localeCompare(right.date))
}

function aggregateSessions(runs: ModelUsageRun[]): ModelUsageSessionBreakdown[] {
  const sessions = new Map<string, ModelUsageSessionBreakdown>()
  for (const run of runs) {
    const key = `${run.source}:${run.sessionId}`
    const item = sessions.get(key) || {
      sessionId: run.sessionId,
      title: run.sessionTitle,
      workspaceName: run.workspaceName,
      source: run.source,
      totalTokens: 0,
      requestCount: 0,
      costUSD: 0,
      lastUsedAt: 0,
    }
    const totals = totalsForRun(run)
    item.title = run.sessionTitle || item.title
    item.workspaceName = run.workspaceName || item.workspaceName
    item.totalTokens += totals.totalTokens
    item.requestCount += 1
    item.costUSD += totals.costUSD
    item.lastUsedAt = Math.max(item.lastUsedAt, run.recordedAt)
    sessions.set(key, item)
  }
  return [...sessions.values()].sort((left, right) => (
    right.totalTokens - left.totalTokens || right.lastUsedAt - left.lastUsedAt
  ))
}

function aggregateSkills(runs: ModelUsageRun[]): ModelUsageSkillBreakdown[] {
  const skills = new Map<string, ModelUsageSkillBreakdown & { sessionIds: Set<string> }>()
  for (const run of runs) {
    const skillIds = [...new Set(run.skillIds.filter(Boolean))]
    if (skillIds.length === 0) continue
    const totals = totalsForRun(run)
    const share = 1 / skillIds.length
    for (const skillId of skillIds) {
      const item = skills.get(skillId) || {
        skillId,
        totalTokens: 0,
        requestCount: 0,
        sessionCount: 0,
        costUSD: 0,
        lastUsedAt: 0,
        sessionIds: new Set<string>(),
      }
      item.totalTokens += totals.totalTokens * share
      item.costUSD += totals.costUSD * share
      item.requestCount += 1
      item.sessionIds.add(`${run.source}:${run.sessionId}`)
      item.sessionCount = item.sessionIds.size
      item.lastUsedAt = Math.max(item.lastUsedAt, run.recordedAt)
      skills.set(skillId, item)
    }
  }
  return [...skills.values()]
    .map(({ sessionIds: _sessionIds, ...item }) => ({
      ...item,
      totalTokens: Math.round(item.totalTokens),
    }))
    .sort((left, right) => right.totalTokens - left.totalTokens || left.skillId.localeCompare(right.skillId))
}

function aggregateModels(runs: ModelUsageRun[]): ModelUsageModelBreakdown[] {
  const models = new Map<string, ModelUsageModelBreakdown>()
  for (const run of runs) {
    const seen = new Set<string>()
    for (const model of run.models) {
      const item = models.get(model.modelId) || {
        modelId: model.modelId,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
        thinkingTokens: 0,
        totalTokens: 0,
        requestCount: 0,
        costUSD: 0,
      }
      item.inputTokens += model.inputTokens
      item.outputTokens += model.outputTokens
      item.cacheReadInputTokens += model.cacheReadInputTokens
      item.cacheCreationInputTokens += model.cacheCreationInputTokens
      item.thinkingTokens += model.thinkingTokens
      item.totalTokens += tokensForModel(model)
      item.costUSD += model.costUSD
      if (!seen.has(model.modelId)) {
        item.requestCount += 1
        seen.add(model.modelId)
      }
      models.set(model.modelId, item)
    }
  }
  return [...models.values()].sort((left, right) => right.totalTokens - left.totalTokens)
}

export function buildModelUsageSummaries(
  runs: ModelUsageRun[],
  profileIds: string[],
): ModelUsageProfileSummary[] {
  return profileIds.map((profileId) => {
    const profileRuns = filterRuns(runs, profileId, 'all', Date.now())
    return {
      profileId,
      totals: aggregateTotals(profileRuns),
      recordingSince: profileRuns.length > 0
        ? Math.min(...profileRuns.map((run) => run.recordedAt))
        : null,
    }
  })
}

export function buildModelUsageDetail(
  runs: ModelUsageRun[],
  profileId: string,
  range: ModelUsageRange,
  now = Date.now(),
): ModelUsageDetail {
  const profileRuns = filterRuns(runs, profileId, range, now)
  const allProfileRuns = filterRuns(runs, profileId, 'all', now)
  return {
    profileId,
    range,
    totals: aggregateTotals(profileRuns),
    recordingSince: allProfileRuns.length > 0
      ? Math.min(...allProfileRuns.map((run) => run.recordedAt))
      : null,
    daily: aggregateDaily(profileRuns),
    sessions: aggregateSessions(profileRuns),
    skills: aggregateSkills(profileRuns),
    models: aggregateModels(profileRuns),
  }
}

export function extractSkillIdFromToolInput(input: Record<string, unknown>): string | null {
  for (const key of ['skill', 'skillId', 'skill_id', 'name']) {
    const value = input[key]
    if (typeof value === 'string' && value.trim()) return value.trim().replace(/^\//, '')
  }
  return null
}
