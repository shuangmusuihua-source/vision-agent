import { describe, expect, it, vi } from 'vitest'

async function loadAgentOptions() {
  vi.resetModules()

  vi.doMock('../src/main/persistence/profile-store', () => ({
    getApiKey: () => 'sk-app-profile',
    getBaseUrl: () => 'https://api.deepseek.com/anthropic',
    getModel: () => 'deepseek-v4-flash',
  }))
  vi.doMock('../src/main/skill-init', () => ({
    getAppSkillsCwd: () => '/tmp/sumi',
  }))
  vi.doMock('../src/main/app-identity', () => ({
    getAppUserDataDir: () => '/tmp/sumi-user-data',
  }))

  return import('../src/main/agent-options')
}

describe('agent options', () => {
  it('always routes through the app profile baseUrl, including restrictive background runs', async () => {
    const { buildAgentOptions } = await loadAgentOptions()

    const options = buildAgentOptions({
      memoryMode: 'disabled',
      permissionMode: 'acceptEdits',
      allowedTools: [],
      restrictiveBaseUrl: true,
      settingSources: [],
    })

    expect(options.model).toBe('deepseek-v4-flash')
    expect(options.env).toEqual(expect.objectContaining({
      ANTHROPIC_API_KEY: 'sk-app-profile',
      ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic',
    }))
    expect(options.settingSources).toEqual([])
    expect(options.settings).toEqual({ autoMemoryEnabled: false })
  })

  it('uses one app-global memory directory independent of the Agent cwd', async () => {
    const { buildAgentOptions } = await loadAgentOptions()

    const options = buildAgentOptions({
      memoryMode: 'global',
      cwd: '/tmp/a-session-directory',
      permissionMode: 'default',
      allowedTools: [],
    })

    expect(options.settings).toEqual({
      autoMemoryEnabled: true,
      autoMemoryDirectory: '/tmp/sumi-user-data/memory',
    })
    expect(options.systemPrompt).toMatchObject({
      type: 'preset',
      preset: 'claude_code',
      append: expect.stringContaining('禁止按时间线无限追加重复记录'),
    })
    const append = (options.systemPrompt as { append: string }).append
    expect(append).toContain('不是通用世界知识')
    expect(append).toContain('不是任务日志')
    expect(append).toContain('不得包含密码、令牌、API Key')
    expect(append).toContain('自动化运行结果属于自动化历史')
  })
})
