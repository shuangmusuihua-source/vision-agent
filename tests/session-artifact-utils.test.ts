import { describe, expect, it } from 'vitest'
import { join } from 'path'
import {
  artifactCategoryFromFileType,
  artifactFileTypeFromPath,
  extractArtifactPathFromToolInput,
  isMemoryArtifactPath,
  normalizeArtifactPath,
} from '../src/main/artifact-utils'

describe('session artifact utilities', () => {
  it('normalizes relative artifact paths against the session workspace', () => {
    const workspacePath = '/Users/example/Documents/VisionAgent/NEXTAI'

    expect(normalizeArtifactPath('report.md', workspacePath)).toBe(
      join(workspacePath, 'report.md')
    )
  })

  it('preserves absolute artifact paths', () => {
    const absolutePath = '/Users/example/Documents/VisionAgent/NEXTAI/report.md'

    expect(normalizeArtifactPath(absolutePath, '/tmp/other')).toBe(absolutePath)
  })

  it('classifies slide-like outputs as skill outputs and markdown as documents', () => {
    expect(artifactFileTypeFromPath('deck.html')).toBe('html')
    expect(artifactCategoryFromFileType('html')).toBe('skill_output')
    expect(artifactFileTypeFromPath('diagram.svg')).toBe('svg')
    expect(artifactCategoryFromFileType('svg')).toBe('skill_output')
    expect(artifactFileTypeFromPath('summary.md')).toBe('md')
    expect(artifactCategoryFromFileType('md')).toBe('document')
  })

  it('extracts file_path only from Write/Edit tool inputs', () => {
    expect(extractArtifactPathFromToolInput('Write', { file_path: 'a.md' })).toBe('a.md')
    expect(extractArtifactPathFromToolInput('Edit', { file_path: 'b.md' })).toBe('b.md')
    expect(extractArtifactPathFromToolInput('Read', { file_path: 'c.md' })).toBeNull()
    expect(extractArtifactPathFromToolInput('Write', { file_path: '' })).toBeNull()
  })

  it('excludes memory files from session artifact collection', () => {
    expect(isMemoryArtifactPath('/Users/example/ws/.vision/memory/user.md')).toBe(true)
    expect(isMemoryArtifactPath('/Users/example/ws/notes/user.md')).toBe(false)
  })
})
