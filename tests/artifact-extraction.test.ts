import { describe, it, expect } from 'vitest'
import {
  extractSkillOutputContent,
} from '../src/renderer/store/message-pipeline'

describe('extractSkillOutputContent', () => {
  it('extracts content from a complete skill-output code block', () => {
    const text = 'Some text\n```skill-output\n<h1>Hello</h1>\n```\nMore text'
    expect(extractSkillOutputContent(text)).toBe('<h1>Hello</h1>\n')
  })

  it('extracts content from an incomplete (streaming) skill-output block', () => {
    const text = '```skill-output\n<h1>Partial'
    expect(extractSkillOutputContent(text)).toBe('<h1>Partial')
  })

  it('returns null when no skill-output block present', () => {
    expect(extractSkillOutputContent('Just some text')).toBeNull()
    expect(extractSkillOutputContent('```\ncode\n```')).toBeNull()
  })

  it('handles empty string', () => {
    expect(extractSkillOutputContent('')).toBeNull()
  })

  it('extracts only the first skill-output block', () => {
    const text = '```skill-output\nFirst\n```\n```skill-output\nSecond\n```'
    expect(extractSkillOutputContent(text)).toBe('First\n')
  })

  it('handles skill-output with no content', () => {
    expect(extractSkillOutputContent('```skill-output\n```')).toBe('')
  })

  it('handles multiline content with HTML', () => {
    const text = '```skill-output\n<!DOCTYPE html>\n<html>\n<body>\n</body>\n</html>\n```'
    const result = extractSkillOutputContent(text)
    expect(result).toContain('<!DOCTYPE html>')
    expect(result).toContain('<html>')
  })
})
