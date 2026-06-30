import { describe, expect, it } from 'vitest'
import { buildSumiContextPrompt, buildSumiIdentityPrompt } from '../src/main/agent-identity'

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

  it('does not expose the internal cwd as an Ask sumi workspace', () => {
    const prompt = buildSumiContextPrompt('ask', '/internal/app-data')

    expect(prompt).toContain('独立于工作区')
    expect(prompt).not.toContain('## 当前工作区')
    expect(prompt).not.toContain('关键结论应记录')
    expect(prompt).not.toContain('/internal/app-data')
  })

  it('keeps workspace persistence guidance in editor sessions', () => {
    const prompt = buildSumiContextPrompt('editor', '/workspace/product-plan')

    expect(prompt).toContain('## 当前工作区')
    expect(prompt).toContain('/workspace/product-plan')
    expect(prompt).toContain('关键结论应记录')
  })
})
