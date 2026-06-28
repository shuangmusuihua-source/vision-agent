import { describe, expect, it } from 'vitest'
import { resolveEnabledSkillIds, updateSkillPreference } from '../src/shared/skill-settings'

describe('Skill preferences', () => {
  it('enables built-in Skills by default, including newly added ones', () => {
    expect(resolveEnabledSkillIds([], ['slides', 'documents'], [])).toEqual(['slides', 'documents'])
    expect(resolveEnabledSkillIds(['slides'], ['slides', 'documents'], [])).toEqual(['slides', 'documents'])
  })

  it('keeps an explicitly disabled built-in Skill disabled', () => {
    expect(resolveEnabledSkillIds(['slides'], ['slides', 'documents'], ['documents']))
      .toEqual(['slides'])
  })

  it('removes the disabled marker when a Skill is enabled again', () => {
    expect(updateSkillPreference(['slides'], ['documents'], 'documents', true)).toEqual({
      enabledSkillIds: ['slides', 'documents'],
      disabledSkillIds: [],
    })
  })
})
