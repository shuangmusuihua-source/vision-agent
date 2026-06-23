export type AttachmentKind = 'text' | 'image' | 'pdf'

export interface PromptAttachment {
  name: string
  path: string
  type: AttachmentKind
}

export const CONVERTIBLE_ATTACHMENT_EXTENSIONS = ['pptx', 'xlsx', 'docx', 'pdf'] as const

const CONVERTIBLE_EXTENSION_SET = new Set<string>(CONVERTIBLE_ATTACHMENT_EXTENSIONS)

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
  const icon = file.type === 'image' ? '🖼️' : file.type === 'pdf' ? '📕' : '📄'
  const label = file.type === 'image' ? '图片' : file.type === 'pdf' ? 'PDF文档' : '文件'
  const pathLabel = isConvertibleAttachmentPath(file.path || file.name) ? '原始路径' : '路径'

  return `${icon} ${label}：${file.name} | ${pathLabel}：${sanitizePromptPath(file.path)}`
}
