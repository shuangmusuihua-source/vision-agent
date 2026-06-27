import manifest from './skills-manifest.json'

export interface BuiltinSkillManifest {
  id: string
  hasResources: boolean
  contentVersion: number
  requiredPaths: string[]
}

export const BUILTIN_SKILLS: BuiltinSkillManifest[] = manifest
