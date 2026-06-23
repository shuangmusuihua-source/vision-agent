import { describe, expect, it } from 'vitest'
import {
  encodeFileConvertPath,
  fileExtension,
  formatAttachmentPromptLine,
  isConvertibleAttachmentPath,
} from '../src/shared/file-attachments'
import {
  appendAttachmentConversionSummary,
  parseFileConvertPaths,
  safeAttachmentSegment,
  stripFileConvertMarker,
} from '../src/main/attachment-conversion'

describe('file attachment prompt references', () => {
  it('formats normal attachments with an explicit source path', () => {
    const line = formatAttachmentPromptLine({
      name: 'notes.md',
      path: '/Users/me/work/a/notes.md',
      type: 'text',
    })

    expect(line).toContain('notes.md')
    expect(line).toContain('路径：/Users/me/work/a/notes.md')
  })

  it('marks convertible attachments as original paths', () => {
    const line = formatAttachmentPromptLine({
      name: 'report.pdf',
      path: '/Users/me/Documents/report.pdf',
      type: 'pdf',
    })

    expect(line).toContain('report.pdf')
    expect(line).toContain('原始路径：/Users/me/Documents/report.pdf')
  })

  it('detects convertible file extensions case-insensitively', () => {
    expect(fileExtension('/tmp/REPORT.PPTX')).toBe('pptx')
    expect(isConvertibleAttachmentPath('/tmp/REPORT.PPTX')).toBe(true)
    expect(isConvertibleAttachmentPath('/tmp/notes.md')).toBe(false)
  })
})

describe('file conversion markers', () => {
  it('parses encoded paths without losing delimiter characters', () => {
    const sourcePath = '/Users/me/Documents/a|b/report 2026.pdf'
    const prompt = `<!--FILE_CONVERT:${encodeFileConvertPath(sourcePath)}-->\n📕 PDF文档：report 2026.pdf`

    expect(parseFileConvertPaths(prompt)).toEqual([sourcePath])
  })

  it('strips conversion markers while preserving user-visible attachment lines', () => {
    const prompt = '<!--FILE_CONVERT:/tmp/a.pdf-->\n📕 PDF文档：a.pdf | 原始路径：/tmp/a.pdf'

    expect(stripFileConvertMarker(prompt)).toBe('📕 PDF文档：a.pdf | 原始路径：/tmp/a.pdf')
  })

  it('builds a conversion summary with concrete Markdown paths', () => {
    const prompt = '请总结附件'
    const result = appendAttachmentConversionSummary(prompt, {
      converted: [{
        sourcePath: '/Users/me/Documents/report.pdf',
        markdownPath: '/Users/me/work/.vision/attachments/session/report-a1b2c3d4e5.md',
      }],
      failed: [],
    })

    expect(result).toContain('Markdown路径: /Users/me/work/.vision/attachments/session/report-a1b2c3d4e5.md')
    expect(result).toContain('请优先使用 Read 工具读取 Markdown 路径')
  })

  it('sanitizes session path segments', () => {
    expect(safeAttachmentSegment('new/editor:123')).toBe('new-editor-123')
  })
})
