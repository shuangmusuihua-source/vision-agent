import { describe, expect, it } from 'vitest'
import {
  buildModelUsageDetail,
  buildModelUsageSummaries,
  extractSkillIdFromToolInput,
  type ModelUsageRun,
} from '../src/main/model-usage-analytics'

const NOW = new Date('2026-09-04T12:00:00+08:00').getTime()

function run(overrides: Partial<ModelUsageRun> = {}): ModelUsageRun {
  return {
    id: 'run-1',
    recordedAt: NOW,
    profileId: 'profile-1',
    profileName: 'Sonnet',
    configuredModel: 'claude-sonnet',
    source: 'interactive',
    sessionId: 'session-1',
    sessionTitle: '产品方案',
    workspaceName: 'EyesOn',
    skillIds: ['frontend-design'],
    durationMs: 1_000,
    numTurns: 2,
    totalCostUSD: 0.01,
    models: [{
      modelId: 'claude-sonnet-4-6',
      inputTokens: 100,
      outputTokens: 50,
      cacheReadInputTokens: 20,
      cacheCreationInputTokens: 10,
      thinkingTokens: 5,
      costUSD: 0.01,
    }],
    ...overrides,
  }
}

describe('model usage analytics', () => {
  it('aggregates totals, sessions, actual models and daily usage for one profile', () => {
    const detail = buildModelUsageDetail([
      run(),
      run({
        id: 'run-2',
        sessionId: 'session-2',
        sessionTitle: '路演材料',
        recordedAt: NOW - 24 * 60 * 60 * 1000,
        totalCostUSD: 0.02,
        skillIds: ['frontend-design', 'kami'],
        models: [{
          modelId: 'claude-sonnet-4-6',
          inputTokens: 200,
          outputTokens: 100,
          cacheReadInputTokens: 50,
          cacheCreationInputTokens: 0,
          thinkingTokens: 10,
          costUSD: 0.02,
        }],
      }),
      run({ id: 'other-profile', profileId: 'profile-2' }),
    ], 'profile-1', '30d', NOW)

    expect(detail.totals).toMatchObject({
      inputTokens: 300,
      outputTokens: 150,
      cacheReadInputTokens: 70,
      cacheCreationInputTokens: 10,
      thinkingTokens: 15,
      totalTokens: 530,
      requestCount: 2,
      sessionCount: 2,
    })
    expect(detail.totals.costUSD).toBeCloseTo(0.03)
    expect(detail.sessions.map((item) => item.sessionId)).toEqual(['session-2', 'session-1'])
    expect(detail.models).toEqual([expect.objectContaining({
      modelId: 'claude-sonnet-4-6',
      totalTokens: 530,
      requestCount: 2,
    })])
    expect(detail.daily).toHaveLength(2)
  })

  it('splits a multi-Skill run instead of double-counting its tokens', () => {
    const detail = buildModelUsageDetail([
      run({
        totalCostUSD: 0.02,
        skillIds: ['frontend-design', 'kami'],
        models: [{
          modelId: 'claude-sonnet-4-6',
          inputTokens: 200,
          outputTokens: 100,
          cacheReadInputTokens: 50,
          cacheCreationInputTokens: 0,
          thinkingTokens: 10,
          costUSD: 0.02,
        }],
      }),
    ], 'profile-1', 'all', NOW)

    expect(detail.skills).toEqual([
      expect.objectContaining({ skillId: 'frontend-design', totalTokens: 175, requestCount: 1 }),
      expect.objectContaining({ skillId: 'kami', totalTokens: 175, requestCount: 1 }),
    ])
    expect(detail.skills.reduce((sum, item) => sum + item.totalTokens, 0)).toBe(350)
    expect(detail.skills.reduce((sum, item) => sum + item.costUSD, 0)).toBeCloseTo(0.02)
  })

  it('filters rolling ranges while keeping the original recording date', () => {
    const oldRun = run({ id: 'old', recordedAt: NOW - 40 * 24 * 60 * 60 * 1000 })
    const detail = buildModelUsageDetail([oldRun, run()], 'profile-1', '30d', NOW)

    expect(detail.totals.requestCount).toBe(1)
    expect(detail.recordingSince).toBe(oldRun.recordedAt)
  })

  it('returns zero summaries for configured profiles without recorded usage', () => {
    const summaries = buildModelUsageSummaries([run()], ['profile-1', 'profile-2'])
    expect(summaries[0].totals.totalTokens).toBe(180)
    expect(summaries[1]).toEqual(expect.objectContaining({
      profileId: 'profile-2',
      recordingSince: null,
      totals: expect.objectContaining({ totalTokens: 0, requestCount: 0 }),
    }))
  })

  it('extracts Skill identifiers from supported SDK input shapes', () => {
    expect(extractSkillIdFromToolInput({ skill: '/kami' })).toBe('kami')
    expect(extractSkillIdFromToolInput({ skill_id: 'feishu' })).toBe('feishu')
    expect(extractSkillIdFromToolInput({})).toBeNull()
  })
})
