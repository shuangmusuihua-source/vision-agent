import { describe, expect, it } from 'vitest'
import { buildSumiIdentityPrompt } from '../src/main/agent-identity'

describe('sumi agent identity prompt', () => {
  it('brands identity answers as sumi instead of implementation details', () => {
    const prompt = buildSumiIdentityPrompt('editor')

    expect(prompt).toContain('你是 sumi')
    expect(prompt).toContain('不要把自己介绍成 Claude Code')
    expect(prompt).toContain('底层模型或技术实现')
    expect(prompt).toContain('工作区')
    expect(prompt).toContain('交付物')
  })

  it('keeps Ask sumi separate from workspace task assumptions', () => {
    const prompt = buildSumiIdentityPrompt('ask')

    expect(prompt).toContain('Ask sumi 首页场景')
    expect(prompt).toContain('通用问答')
    expect(prompt).toContain('不要主动假设用户正在某个工作区内推进任务')
  })
})
