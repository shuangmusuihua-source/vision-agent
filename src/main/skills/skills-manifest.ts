export interface BuiltinSkillManifest {
  id: string
  hasResources: boolean
}

export const BUILTIN_SKILLS: BuiltinSkillManifest[] = [
  { id: 'kami', hasResources: true },
]
