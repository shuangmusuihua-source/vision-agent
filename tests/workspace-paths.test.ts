import { describe, expect, it } from 'vitest'
import {
  findContainingWorkspacePath,
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

  it('finds the workspace that contains a file without matching sibling prefixes', () => {
    expect(findContainingWorkspacePath(
      '/Users/me/Documents/sumi/product/report.md',
      ['/Users/me/Documents/sumi/pro', '/Users/me/Documents/sumi/product'],
    )).toBe('/Users/me/Documents/sumi/product')
  })

  it('prefers the most specific workspace when roots are nested', () => {
    expect(findContainingWorkspacePath(
      '/Users/me/Documents/sumi/product/research/report.md',
      ['/Users/me/Documents/sumi/product', '/Users/me/Documents/sumi/product/research'],
    )).toBe('/Users/me/Documents/sumi/product/research')
  })

  it('supports Windows separators and returns null outside known workspaces', () => {
    expect(findContainingWorkspacePath(
      'C:\\Users\\me\\sumi\\product\\report.md',
      ['C:\\Users\\me\\sumi\\product'],
    )).toBe('C:\\Users\\me\\sumi\\product')
    expect(findContainingWorkspacePath('/tmp/report.md', ['/Users/me/Documents/sumi/product'])).toBeNull()
  })
})
