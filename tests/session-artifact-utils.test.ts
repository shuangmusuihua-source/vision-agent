import { describe, expect, it } from 'vitest'
import {
  artifactCategoryFromFileType,
  artifactFileTypeFromPath,
} from '../src/main/artifact-utils'

describe('session artifact utilities', () => {
  it('classifies slide-like outputs as skill outputs and markdown as documents', () => {
    expect(artifactFileTypeFromPath('deck.html')).toBe('html')
    expect(artifactCategoryFromFileType('html')).toBe('skill_output')
    expect(artifactFileTypeFromPath('diagram.svg')).toBe('svg')
    expect(artifactCategoryFromFileType('svg')).toBe('skill_output')
    expect(artifactFileTypeFromPath('summary.md')).toBe('md')
    expect(artifactCategoryFromFileType('md')).toBe('document')
    expect(artifactFileTypeFromPath('research.pdf')).toBe('pdf')
    expect(artifactCategoryFromFileType('pdf')).toBe('skill_output')
    expect(artifactCategoryFromFileType('pptx')).toBe('skill_output')
    expect(artifactFileTypeFromPath('archive.zip')).toBe('other')
    expect(artifactCategoryFromFileType('other')).toBe('other')
  })

})
