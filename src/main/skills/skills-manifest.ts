export interface BuiltinSkillManifest {
  id: string
  hasResources: boolean
}

export const BUILTIN_SKILLS: BuiltinSkillManifest[] = [
  { id: 'kami', hasResources: true },
  { id: 'guizang-ppt-skill', hasResources: true },
  { id: 'frontend-slides', hasResources: true },
  { id: 'system-cleanup', hasResources: true },
  { id: 'organize-desktop', hasResources: false },
  { id: 'organize-folder', hasResources: false },
]
