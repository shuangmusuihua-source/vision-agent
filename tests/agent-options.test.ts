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
  it('keeps interactive task tools explicit for SDK versions that hide them by default', async () => {
    const { INTERACTIVE_TASK_TOOLS } = await loadAgentOptions()

    expect(INTERACTIVE_TASK_TOOLS).toEqual([
      'TaskCreate',
      'TaskGet',
      'TaskUpdate',
      'TaskList',
    ])
  })

  it('always routes through the app profile baseUrl for background runs', async () => {
    const { buildAgentOptions } = await loadAgentOptions()

    const options = buildAgentOptions({
      memoryMode: 'disabled',
      permissionMode: 'acceptEdits',
      allowedTools: [],
      settingSources: [],
    })

    expect(options.model).toBe('deepseek-v4-flash')
    expect(options.env).toEqual(expect.objectContaining({
      ANTHROPIC_API_KEY: 'sk-app-profile',
      ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic',
      PYTHONDONTWRITEBYTECODE: '1',
    }))
    expect(options.settingSources).toEqual([])
    expect(options.settings).toEqual({ autoMemoryEnabled: false })
    expect(options.env?.LARKSUITE_CLI_CONFIG_DIR).toBeUndefined()
    expect(options.env?.PATH).not.toContain('/runtimes/lark-cli/')
  })

  it('exposes the isolated Feishu runtime only when the ready Skill is enabled', async () => {
    const { buildAgentOptions } = await loadAgentOptions()

    const options = buildAgentOptions({
      memoryMode: 'disabled',
      permissionMode: 'default',
      allowedTools: ['Bash'],
      skills: ['feishu'],
    })

    expect(options.env).toEqual(expect.objectContaining({
      LARKSUITE_CLI_CONFIG_DIR: '/tmp/sumi-user-data/connectors/feishu',
      LARKSUITE_CLI_NO_UPDATE_NOTIFIER: '1',
      LARKSUITE_CLI_NO_SKILLS_NOTIFIER: '1',
    }))
    expect(options.env?.PATH).toContain('/tmp/sumi-user-data/runtimes/lark-cli/1.0.89/agent-bin')
  })

  it('exposes only the DingTalk shim with isolated config and encrypted token storage', async () => {
    const { buildAgentOptions } = await loadAgentOptions()
    const options = buildAgentOptions({ memoryMode: 'disabled', permissionMode: 'default', skills: ['dingtalk'] })
    expect(options.env?.DWS_CONFIG_DIR).toBe('/tmp/sumi-user-data/connectors/dingtalk')
    expect(options.env?.DWS_KEYCHAIN_DIR).toBe('/tmp/sumi-user-data/connectors/dingtalk/keychain')
    expect(options.env?.DWS_DISABLE_KEYCHAIN).toBeUndefined()
    expect(options.env?.PATH).toContain('/runtimes/dws/1.0.61/agent-bin')
    expect(options.env?.PATH).not.toContain('/runtimes/dws/1.0.61/bin')
    const withoutSkill = buildAgentOptions({ memoryMode: 'disabled', permissionMode: 'default', skills: [] })
    expect(withoutSkill.env?.DWS_CONFIG_DIR).toBeUndefined()
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
