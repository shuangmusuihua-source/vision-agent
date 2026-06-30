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
  if (ext === 'md' || ext === 'markdown') return 'md'
  return 'other'
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
  if (fileType === 'md' || fileType === 'json' || fileType === 'png') return 'document'
  return 'other'
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

function extractSupportedArtifactPaths(value: string): string[] {
  const pathPattern = new RegExp(
    `"([^"\\n]+\\.${BASH_ARTIFACT_EXTENSION})"|'([^'\\n]+\\.${BASH_ARTIFACT_EXTENSION})'|([^\\s"'|;&<>]+\\.${BASH_ARTIFACT_EXTENSION})`,
    'gi'
  )
  const paths = new Set<string>()
  for (const match of value.matchAll(pathPattern)) {
    const filePath = match[1] || match[2] || match[3]
    if (filePath) paths.add(filePath)
  }
  return [...paths]
}

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
  const candidates = extractSupportedArtifactPaths(command)
  const paths = new Set<string>()

  for (const match of command.matchAll(/(?:^|\s)(?:--out(?:put)?|-o)(?:=|\s+)(?:"[^"]+"|'[^']+'|[^\s|;&<>]+)/gi)) {
    const output = extractSupportedArtifactPaths(match[0]).at(-1)
    if (output) paths.add(output)
  }

  for (const match of command.matchAll(/>{1,2}\s*(?:"[^"]+"|'[^']+'|[^\s|;&<>]+)/g)) {
    const output = extractSupportedArtifactPaths(match[0]).at(-1)
    if (output) paths.add(output)
  }

  for (const match of command.matchAll(/\btee\s+(?:-[A-Za-z]+\s+)*(?:"[^"]+"|'[^']+'|[^\s|;&<>]+)/gi)) {
    const output = extractSupportedArtifactPaths(match[0]).at(-1)
    if (output) paths.add(output)
  }

  if (/(?:^|[;&|]\s*)(?:cp|mv)\b/i.test(command)) {
    const destination = candidates.at(-1)
    if (destination) paths.add(destination)
  }

  // The bundled frontend-slides exporter derives <input>.pdf when the
  // optional output argument is omitted. Register that implicit output too.
  if (/\bexport-pdf\.sh\b/i.test(command)) {
    const explicitPdf = candidates.find((filePath) => /\.pdf$/i.test(filePath))
    if (explicitPdf) paths.add(explicitPdf)
    const htmlInput = candidates.find((filePath) => /\.html?$/i.test(filePath))
    if (!explicitPdf && htmlInput) paths.add(htmlInput.replace(/\.html?$/i, '.pdf'))
  }

  return [...paths]
}
