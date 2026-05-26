export interface BuiltinSkillManifest {
  id: string
  hasResources: boolean
}

export const BUILTIN_SKILLS: BuiltinSkillManifest[] = [
  { id: 'kami', hasResources: true },
  { id: 'guizang-ppt-skill', hasResources: true },
  { id: 'frontend-slides', hasResources: true },
]
