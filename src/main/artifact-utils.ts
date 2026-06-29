import { basename, extname, isAbsolute, resolve, sep } from 'path'
import type { ArtifactFileType, SessionArtifactRecord } from '../shared/types'

export function normalizeArtifactPath(filePath: string, workspacePath?: string | null): string {
  return isAbsolute(filePath) ? filePath : resolve(workspacePath || process.cwd(), filePath)
}

export function artifactFileName(filePath: string): string {
  return basename(filePath)
}

export function artifactFileTypeFromPath(filePath: string): ArtifactFileType {
  const ext = extname(filePath).slice(1).toLowerCase()
  if (ext === 'html' || ext === 'htm') return 'html'
  if (ext === 'svg') return 'svg'
  if (ext === 'json') return 'json'
  if (ext === 'png' || ext === 'jpg' || ext === 'jpeg') return 'png'
  if (ext === 'pdf') return 'pdf'
  if (ext === 'docx') return 'docx'
  if (ext === 'pptx') return 'pptx'
  if (ext === 'xlsx') return 'xlsx'
  return 'md'
}

export function artifactCategoryFromFileType(
  fileType: ArtifactFileType
): SessionArtifactRecord['category'] {
  if (
    fileType === 'html'
    || fileType === 'svg'
    || fileType === 'pdf'
    || fileType === 'docx'
    || fileType === 'pptx'
    || fileType === 'xlsx'
  ) return 'skill_output'
  return 'document'
}

export function isMemoryArtifactPath(filePath: string): boolean {
  const marker = `${sep}.vision${sep}memory${sep}`
  return filePath.includes(marker) || filePath.includes('/.vision/memory/')
}

export function extractArtifactPathFromToolInput(
  toolName: string,
  toolInput: unknown
): string | null {
  return extractArtifactPathsFromToolInput(toolName, toolInput)[0] || null
}

const BASH_ARTIFACT_EXTENSION = '(?:html?|md|markdown|svg|png|jpe?g|json|pdf|docx|pptx|xlsx)'

export function extractArtifactPathsFromToolInput(
  toolName: string,
  toolInput: unknown
): string[] {
  if (!toolInput || typeof toolInput !== 'object') return []
  const input = toolInput as Record<string, unknown>

  if (toolName === 'Write' || toolName === 'Edit') {
    const filePath = input.file_path
    return typeof filePath === 'string' && filePath.trim() ? [filePath] : []
  }

  if (toolName !== 'Bash' || typeof input.command !== 'string') return []
  const command = input.command
  const createsFiles = /(?:^|[;&|]\s*)(?:bash|sh|python\d*|node|cp|mv|convert|magick)\b|(?:^|\s)(?:tee\b|>{1,2})/i.test(command)
  if (!createsFiles) return []

  const pathPattern = new RegExp(
    `"([^"\\n]+\\.${BASH_ARTIFACT_EXTENSION})"|'([^'\\n]+\\.${BASH_ARTIFACT_EXTENSION})'|([^\\s"'|;&<>]+\\.${BASH_ARTIFACT_EXTENSION})`,
    'gi'
  )
  const paths = new Set<string>()
  for (const match of command.matchAll(pathPattern)) {
    const filePath = match[1] || match[2] || match[3]
    if (filePath) paths.add(filePath)
  }

  // The bundled frontend-slides exporter derives <input>.pdf when the
  // optional output argument is omitted. Register that implicit output too.
  if (/\bexport-pdf\.sh\b/i.test(command) && ![...paths].some((filePath) => /\.pdf$/i.test(filePath))) {
    const htmlInput = [...paths].find((filePath) => /\.html?$/i.test(filePath))
    if (htmlInput) paths.add(htmlInput.replace(/\.html?$/i, '.pdf'))
  }

  return [...paths]
}
