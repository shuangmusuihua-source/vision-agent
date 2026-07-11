export type AttachmentKind = 'text' | 'image' | 'pdf'

export interface PromptAttachment {
  name: string
  path: string
  type: AttachmentKind
}

export type AttachmentConversionDisplayStatus = {
  sourcePath: string
  status: 'converted' | 'failed'
  markdownPath?: string
  error?: string
}

export const CONVERTIBLE_ATTACHMENT_EXTENSIONS = ['pptx', 'xlsx', 'docx', 'pdf'] as const
export const ATTACHMENT_CONVERSION_CONTEXT_TAG = 'attachment_conversion_context'

const CONVERTIBLE_EXTENSION_SET = new Set<string>(CONVERTIBLE_ATTACHMENT_EXTENSIONS)
const FILE_CONVERT_MARKER_REGEX = /<!--FILE_CONVERT:[\s\S]*?-->\n?/g
const FILE_ATTACHMENT_MARKER_REGEX = /<!--FILE_ATTACH:[\s\S]*?-->\n?/g
const ATTACHMENT_CONVERSION_CONTEXT_REGEX =
  /(?:\n{0,2})<attachment_conversion_context>[\s\S]*?<\/attachment_conversion_context>/g

export function fileExtension(filePathOrName: string): string {
  const fileName = filePathOrName.split(/[\\/]/).pop() || filePathOrName
  const dotIndex = fileName.lastIndexOf('.')
  if (dotIndex < 0 || dotIndex === fileName.length - 1) return ''
  return fileName.slice(dotIndex + 1).toLowerCase()
}

export function isConvertibleAttachmentPath(filePathOrName: string): boolean {
  return CONVERTIBLE_EXTENSION_SET.has(fileExtension(filePathOrName))
}

export function encodeFileConvertPath(filePath: string, grantId?: string): string {
  const encodedPath = encodeURIComponent(filePath)
  return grantId ? `${grantId}@${encodedPath}` : encodedPath
}

export function encodeAttachmentReferencePath(filePath: string, grantId?: string): string {
  const encodedPath = encodeURIComponent(filePath)
  return grantId ? `${grantId}@${encodedPath}` : encodedPath
}

function sanitizePromptPath(filePath: string): string {
  return filePath.replace(/[\r\n]/g, ' ')
}

export function formatAttachmentPromptLine(file: PromptAttachment): string {
  const ext = fileExtension(file.name || file.path)
  const label = file.type === 'image'
    ? '图片'
    : ext
      ? `${ext.toUpperCase()}文档`
      : '文件'
  const pathLabel = isConvertibleAttachmentPath(file.path || file.name) ? '原始路径' : '路径'

  return `附件：${file.name} | 类型：${label} | ${pathLabel}：${sanitizePromptPath(file.path)}`
}

function extractConversionContextBlocks(text: string): string[] {
  const blocks: string[] = []
  const tagRegex = new RegExp(
    `<${ATTACHMENT_CONVERSION_CONTEXT_TAG}>([\\s\\S]*?)<\\/${ATTACHMENT_CONVERSION_CONTEXT_TAG}>`,
    'g'
  )

  for (const match of text.matchAll(tagRegex)) {
    blocks.push(match[1])
  }

  return blocks
}

export function parseAttachmentConversionStatuses(text: string): AttachmentConversionDisplayStatus[] {
  const statuses: AttachmentConversionDisplayStatus[] = []

  for (const block of extractConversionContextBlocks(text)) {
    let section: AttachmentConversionDisplayStatus['status'] | null = null
    let current: AttachmentConversionDisplayStatus | null = null

    for (const rawLine of block.split('\n')) {
      const line = rawLine.trim()
      if (line.startsWith('附件转换结果')) {
        section = 'converted'
        current = null
        continue
      }
      if (line.startsWith('附件转换失败')) {
        section = 'failed'
        current = null
        continue
      }

      const sourceMatch = line.match(/^- 源文件:\s*(.+)$/)
      if (sourceMatch && section) {
        current = { sourcePath: sourceMatch[1], status: section }
        statuses.push(current)
        continue
      }

      if (!current) continue

      const markdownMatch = line.match(/^Markdown路径:\s*(.+)$/)
      if (markdownMatch && current.status === 'converted') {
        current.markdownPath = markdownMatch[1]
        continue
      }

      const errorMatch = line.match(/^错误:\s*(.+)$/)
      if (errorMatch && current.status === 'failed') {
        current.error = errorMatch[1]
      }
    }
  }

  return statuses
}

export function stripInternalAttachmentContext(text: string): string {
  return text
    .replace(FILE_CONVERT_MARKER_REGEX, '')
    .replace(FILE_ATTACHMENT_MARKER_REGEX, '')
    .replace(ATTACHMENT_CONVERSION_CONTEXT_REGEX, '')
    .trim()
}
