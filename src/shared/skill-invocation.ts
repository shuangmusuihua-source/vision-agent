const SAFE_SKILL_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/i
const SKILL_COMMAND = /^\/([a-z0-9][a-z0-9._:-]{0,127})(?:\s|$)/i

export interface SlashMenuSkillState {
  enabled?: boolean
  hideInSlashMenu?: boolean
}

export function buildSkillInvocationPrompt(
  skillId: string,
  promptTemplate: string,
  activeFileContext: string,
): string {
  if (!SAFE_SKILL_ID.test(skillId)) throw new Error(`Invalid Skill id: ${skillId}`)
  const argumentsText = promptTemplate.replace('{activeFile}', activeFileContext).trim()
  return `/${skillId}${argumentsText ? ` ${argumentsText}` : ''}`
}

export function isSkillAvailableAtInitialization(
  skillId: string,
  discoveredSkills: string[],
  slashCommands: string[],
): boolean {
  const normalize = (value: string) => value.replace(/^\//, '')
  const expected = normalize(skillId)
  return [...discoveredSkills, ...slashCommands].some(value => normalize(value) === expected)
}

export function getSkillInvocationDisplayText(prompt: string): string | null {
  const id = getSkillInvocationId(prompt)
  return id ? `执行 Skill: ${id}` : null
}

export function getSkillInvocationId(prompt: string): string | null {
  return SKILL_COMMAND.exec(prompt.trimStart())?.[1] ?? null
}

export function isSkillVisibleInSlashMenu(skill: SlashMenuSkillState): boolean {
  return skill.enabled !== false && !skill.hideInSlashMenu
}
