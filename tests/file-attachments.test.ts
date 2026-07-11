import { describe, expect, it } from 'vitest'
import {
  ATTACHMENT_CONVERSION_CONTEXT_TAG,
  encodeAttachmentReferencePath,
  encodeFileConvertPath,
  fileExtension,
  formatAttachmentPromptLine,
  isConvertibleAttachmentPath,
  parseAttachmentConversionStatuses,
  stripInternalAttachmentContext,
} from '../src/shared/file-attachments'
import {
  appendAttachmentConversionSummary,
  claimPromptAttachments,
  parseAttachmentReferenceRequests,
  parseAttachmentReferencePaths,
  parseFileConvertPaths,
  parseFileConvertRequests,
  safeAttachmentSegment,
  stripFileConvertMarker,
} from '../src/main/attachment-conversion'
import { createAttachmentPathGrant } from '../src/main/attachment-path-authorization'

describe('file attachment prompt references', () => {
  it('formats normal attachments with an explicit source path', () => {
    const line = formatAttachmentPromptLine({
      name: 'notes.md',
      path: '/Users/me/work/a/notes.md',
      type: 'text',
    })

    expect(line).toContain('notes.md')
    expect(line).toContain('附件：notes.md')
    expect(line).toContain('类型：MD文档')
    expect(line).toContain('路径：/Users/me/work/a/notes.md')
    expect(line).not.toMatch(/[📄📕🖼️]/u)
  })

  it('marks convertible attachments as original paths', () => {
    const line = formatAttachmentPromptLine({
      name: 'report.pdf',
      path: '/Users/me/Documents/report.pdf',
      type: 'pdf',
    })

    expect(line).toContain('report.pdf')
    expect(line).toContain('类型：PDF文档')
    expect(line).toContain('原始路径：/Users/me/Documents/report.pdf')
    expect(line).not.toMatch(/[📄📕🖼️]/u)
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
    const prompt = `<!--FILE_CONVERT:${encodeFileConvertPath(sourcePath)}-->\n附件：report 2026.pdf | 类型：PDF文档 | 原始路径：${sourcePath}`

    expect(parseFileConvertPaths(prompt)).toEqual([sourcePath])
  })

  it('carries a one-turn attachment grant with the conversion path', () => {
    const sourcePath = '/Users/me/Documents/report 2026.pdf'
    const prompt = `<!--FILE_CONVERT:${encodeFileConvertPath(sourcePath, 'grant-123')}-->`

    expect(parseFileConvertRequests(prompt)).toEqual([{
      grantId: 'grant-123',
      sourcePath,
    }])
  })

  it('carries every selected attachment path without parsing visible prose', () => {
    const sourcePath = '/Users/me/Documents/research notes.md'
    const prompt = `<!--FILE_ATTACH:${encodeAttachmentReferencePath(sourcePath, 'grant-123')}-->`

    expect(parseAttachmentReferencePaths(prompt)).toEqual([sourcePath])
    expect(parseAttachmentReferenceRequests(prompt)).toEqual([{
      grantId: 'grant-123',
      sourcePath,
    }])
    expect(stripInternalAttachmentContext(prompt)).toBe('')
  })

  it('claims a selected attachment once and authorizes its matching conversion request', () => {
    const sourcePath = '/Users/me/Documents/report 2026.pdf'
    const grantId = createAttachmentPathGrant([sourcePath])
    const prompt = [
      `<!--FILE_ATTACH:${encodeAttachmentReferencePath(sourcePath, grantId)}-->`,
      `<!--FILE_CONVERT:${encodeFileConvertPath(sourcePath, grantId)}-->`,
    ].join('\n')

    expect(claimPromptAttachments(prompt)).toEqual({
      attachmentPaths: [sourcePath],
      convertRequests: [{ grantId, sourcePath }],
    })
    expect(() => claimPromptAttachments(prompt)).toThrow('附件路径未获得授权')
  })

  it('strips conversion markers while preserving user-visible attachment lines', () => {
    const prompt = '<!--FILE_CONVERT:/tmp/a.pdf-->\n附件：a.pdf | 类型：PDF文档 | 原始路径：/tmp/a.pdf'

    expect(stripFileConvertMarker(prompt)).toBe('附件：a.pdf | 类型：PDF文档 | 原始路径：/tmp/a.pdf')
  })

  it('builds an internal conversion context with concrete Markdown paths', () => {
    const prompt = '请总结附件'
    const result = appendAttachmentConversionSummary(prompt, {
      converted: [{
        sourcePath: '/Users/me/Documents/report.pdf',
        markdownPath: '/Users/me/work/.vision/attachments/session/report-a1b2c3d4e5.md',
      }],
      failed: [],
    })

    expect(result).toContain(`<${ATTACHMENT_CONVERSION_CONTEXT_TAG}>`)
    expect(result).toContain(`</${ATTACHMENT_CONVERSION_CONTEXT_TAG}>`)
    expect(result).toContain('Markdown路径: /Users/me/work/.vision/attachments/session/report-a1b2c3d4e5.md')
    expect(result).toContain('请优先使用 Read 工具读取 Markdown 路径')
  })

  it('strips internal conversion context from user-visible text', () => {
    const prompt = [
      '<!--FILE_CONVERT:/tmp/a.pdf-->',
      '附件：a.pdf | 类型：PDF文档 | 原始路径：/tmp/a.pdf',
      '',
      `<${ATTACHMENT_CONVERSION_CONTEXT_TAG}>`,
      '附件转换结果：',
      '- 源文件: /tmp/a.pdf',
      '  Markdown路径: /tmp/work/.vision/attachments/a.md',
      `</${ATTACHMENT_CONVERSION_CONTEXT_TAG}>`,
    ].join('\n')

    expect(stripInternalAttachmentContext(prompt)).toBe(
      '附件：a.pdf | 类型：PDF文档 | 原始路径：/tmp/a.pdf'
    )
  })

  it('parses conversion statuses from internal context', () => {
    const prompt = [
      '附件：a.pdf | 类型：PDF文档 | 原始路径：/tmp/a.pdf',
      '',
      `<${ATTACHMENT_CONVERSION_CONTEXT_TAG}>`,
      '附件转换结果：',
      '- 源文件: /tmp/a.pdf',
      '  Markdown路径: /tmp/work/.vision/attachments/a.md',
      '',
      '附件转换失败：',
      '- 源文件: /tmp/b.pdf',
      '  错误: markitdown failed',
      `</${ATTACHMENT_CONVERSION_CONTEXT_TAG}>`,
    ].join('\n')

    expect(parseAttachmentConversionStatuses(prompt)).toEqual([
      {
        sourcePath: '/tmp/a.pdf',
        status: 'converted',
        markdownPath: '/tmp/work/.vision/attachments/a.md',
      },
      {
        sourcePath: '/tmp/b.pdf',
        status: 'failed',
        error: 'markitdown failed',
      },
    ])
  })

  it('sanitizes session path segments', () => {
    expect(safeAttachmentSegment('new/editor:123')).toBe('new-editor-123')
  })
})
