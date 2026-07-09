export interface SkillPreferenceState {
  enabledSkillIds: string[]
  disabledSkillIds: string[]
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

export function resolveEnabledSkillIds(
  storedEnabledSkillIds: string[],
  builtinSkillIds: string[],
  disabledSkillIds: string[],
  availableSkillIds?: string[],
): string[] {
  const disabled = new Set(disabledSkillIds)
  const available = availableSkillIds ? new Set(availableSkillIds) : null
  const resolved = unique(storedEnabledSkillIds)
    .filter(skillId => !disabled.has(skillId) && (!available || available.has(skillId)))

  for (const skillId of builtinSkillIds) {
    if (!disabled.has(skillId) && !resolved.includes(skillId)) resolved.push(skillId)
  }
  return resolved
}

export function updateSkillPreference(
  enabledSkillIds: string[],
  disabledSkillIds: string[],
  skillId: string,
  enabled: boolean,
): SkillPreferenceState {
  const nextEnabled = new Set(enabledSkillIds)
  const nextDisabled = new Set(disabledSkillIds)

  if (enabled) {
    nextEnabled.add(skillId)
    nextDisabled.delete(skillId)
  } else {
    nextEnabled.delete(skillId)
    nextDisabled.add(skillId)
  }

  return {
    enabledSkillIds: [...nextEnabled],
    disabledSkillIds: [...nextDisabled],
  }
}
