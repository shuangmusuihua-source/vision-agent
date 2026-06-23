import { describe, expect, it } from 'vitest'
import {
  filterUserWorkspacePaths,
  isReservedKnowledgeWorkspacePath,
} from '../src/shared/workspace-paths'

describe('workspace path filtering', () => {
  it('treats the current knowledge base as a reserved fixed workspace', () => {
    const knowledgeDir = '/Users/me/Documents/sumi/Knowledge'

    expect(isReservedKnowledgeWorkspacePath(knowledgeDir, [knowledgeDir])).toBe(true)
    expect(filterUserWorkspacePaths([knowledgeDir, '/Users/me/Documents/sumi/demo'], [knowledgeDir])).toEqual([
      '/Users/me/Documents/sumi/demo',
    ])
  })

  it('filters legacy knowledge directories left in authorized settings', () => {
    expect(filterUserWorkspacePaths([
      '/Users/me/Documents/VisionAgent/Knowledge',
      '/Users/me/Documents/sumi/test',
    ])).toEqual(['/Users/me/Documents/sumi/test'])
  })

  it('does not hide unrelated workspaces named Knowledge', () => {
    expect(isReservedKnowledgeWorkspacePath('/Users/me/projects/Knowledge')).toBe(false)
  })
})
