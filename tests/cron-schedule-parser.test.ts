import { describe, expect, it, vi } from 'vitest'
import { parseCronScheduleWithRules, resolveCronSchedule } from '../src/main/cron-schedule-parser'
import { query } from '@anthropic-ai/claude-agent-sdk'

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(),
}))

vi.mock('../src/main/agent-options', () => ({
  buildAgentOptions: vi.fn(() => ({})),
}))

describe('cron schedule parser', () => {
  it('parses common Chinese recurring schedules without model calls', async () => {
    const workday = await resolveCronSchedule({ input: '每个工作日上午九点' })

    expect(workday).toEqual(expect.objectContaining({
      success: true,
      cronExpression: '0 9 * * 1-5',
      source: 'rule',
    }))
    expect(query).not.toHaveBeenCalled()

    expect(parseCronScheduleWithRules('每 30 分钟')).toEqual(expect.objectContaining({
      cronExpression: '*/30 * * * *',
    }))
    expect(parseCronScheduleWithRules('每周三下午三点半')).toEqual(expect.objectContaining({
      cronExpression: '30 15 * * 3',
    }))
  })

  it('falls back to the model and validates returned cron json', async () => {
    vi.mocked(query).mockImplementationOnce(async function* () {
      yield {
        type: 'result',
        subtype: 'success',
        result: '{"cronExpression":"0 10 1 */3 *","normalizedText":"每季度第一天 10:00"}',
      }
    } as never)

    const result = await resolveCronSchedule({ input: '每个季度开始后的上午十点' })

    expect(result).toEqual(expect.objectContaining({
      success: true,
      cronExpression: '0 10 1 */3 *',
      source: 'model',
    }))
  })
})
