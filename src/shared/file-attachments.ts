export type AttachmentKind = 'text' | 'image' | 'pdf'

export interface PromptAttachment {
  name: string
  path: string
  type: AttachmentKind
}

export const CONVERTIBLE_ATTACHMENT_EXTENSIONS = ['pptx', 'xlsx', 'docx', 'pdf'] as const
export const ATTACHMENT_CONVERSION_CONTEXT_TAG = 'attachment_conversion_context'

const CONVERTIBLE_EXTENSION_SET = new Set<string>(CONVERTIBLE_ATTACHMENT_EXTENSIONS)
const FILE_CONVERT_MARKER_REGEX = /<!--FILE_CONVERT:[\s\S]*?-->\n?/g
const ATTACHMENT_CONVERSION_CONTEXT_REGEX =
  /(?:\n{0,2})<attachment_conversion_context>[\s\S]*?<\/attachment_conversion_context>/g
const LEGACY_ATTACHMENT_CONVERSION_SUMMARY_REGEX = /(?:\n{0,2})---\n附件转换(?:结果|失败)：[\s\S]*$/g

export function fileExtension(filePathOrName: string): string {
  const fileName = filePathOrName.split(/[\\/]/).pop() || filePathOrName
  const dotIndex = fileName.lastIndexOf('.')
  if (dotIndex < 0 || dotIndex === fileName.length - 1) return ''
  return fileName.slice(dotIndex + 1).toLowerCase()
}

export function isConvertibleAttachmentPath(filePathOrName: string): boolean {
  return CONVERTIBLE_EXTENSION_SET.has(fileExtension(filePathOrName))
}

export function encodeFileConvertPath(filePath: string): string {
  return encodeURIComponent(filePath)
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

export function stripInternalAttachmentContext(text: string): string {
  return text
    .replace(FILE_CONVERT_MARKER_REGEX, '')
    .replace(ATTACHMENT_CONVERSION_CONTEXT_REGEX, '')
    .replace(LEGACY_ATTACHMENT_CONVERSION_SUMMARY_REGEX, '')
    .trim()
}
