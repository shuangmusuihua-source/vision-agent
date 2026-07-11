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

  return import('../src/main/agent-options')
}

describe('agent options', () => {
  it('always routes through the app profile baseUrl, including restrictive background runs', async () => {
    const { buildAgentOptions } = await loadAgentOptions()

    const options = buildAgentOptions({
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
  })
})
