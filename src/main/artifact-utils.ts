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
  return 'md'
}

export function artifactCategoryFromFileType(
  fileType: ArtifactFileType
): SessionArtifactRecord['category'] {
  if (fileType === 'html' || fileType === 'svg') return 'skill_output'
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
  if (toolName !== 'Write' && toolName !== 'Edit') return null
  if (!toolInput || typeof toolInput !== 'object') return null
  const filePath = (toolInput as Record<string, unknown>).file_path
  return typeof filePath === 'string' && filePath.trim() ? filePath : null
}
