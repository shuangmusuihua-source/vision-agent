import { describe, expect, it } from 'vitest'
import {
  buildSkillInvocationPrompt,
  getSkillInvocationDisplayText,
  isSkillAvailableAtInitialization,
  isSkillVisibleInSlashMenu,
} from '../src/shared/skill-invocation'

describe('Skill invocation', () => {
  it('sends an actual SDK slash command with the selected file context as arguments', () => {
    const prompt = buildSkillInvocationPrompt(
      'frontend-design',
      '基于当前任务设计界面。{activeFile}',
      '\n输入文档：/workspace/brief.md',
    )

    expect(prompt).toBe('/frontend-design 基于当前任务设计界面。\n输入文档：/workspace/brief.md')
  })

  it('recognizes a Skill reported by either SDK initialization list', () => {
    expect(isSkillAvailableAtInitialization('frontend-design', ['frontend-design'], [])).toBe(true)
    expect(isSkillAvailableAtInitialization('frontend-design', [], ['/frontend-design'])).toBe(true)
    expect(isSkillAvailableAtInitialization('frontend-design', ['huashu-design'], [])).toBe(false)
  })

  it('rejects a malformed Skill id before creating a command', () => {
    expect(() => buildSkillInvocationPrompt('../outside', '', '')).toThrow('Invalid Skill id')
  })

  it('collapses an internal slash invocation into one stable user-facing label', () => {
    expect(getSkillInvocationDisplayText('/frontend-design build the page')).toBe('执行 Skill: frontend-design')
    expect(getSkillInvocationDisplayText('普通问题')).toBeNull()
  })

  it('shows only enabled Skills that are intended for the slash menu', () => {
    expect(isSkillVisibleInSlashMenu({ enabled: true })).toBe(true)
    expect(isSkillVisibleInSlashMenu({ enabled: false })).toBe(false)
    expect(isSkillVisibleInSlashMenu({ enabled: true, hideInSlashMenu: true })).toBe(false)
  })
})
