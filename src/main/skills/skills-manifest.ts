import manifest from './skills-manifest.json'

export interface BuiltinSkillManifest {
  id: string
  hasResources: boolean
  requiredPaths: string[]
  version?: string
  source?: {
    repositoryUrl: string
    ref: string
    license: string
  }
}

export const BUILTIN_SKILLS: BuiltinSkillManifest[] = manifest
