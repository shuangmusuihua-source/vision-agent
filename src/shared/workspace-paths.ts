import { DOCUMENTS_DIR_NAME } from './branding'

export const KNOWLEDGE_BASE_NAME = 'Knowledge'

const LEGACY_KNOWLEDGE_PARENT_NAMES = new Set([DOCUMENTS_DIR_NAME, 'VisionAgent'])

function trimTrailingSeparators(value: string): string {
  return value.trim().replace(/[\\/]+$/, '')
}

function normalizeSeparators(value: string): string {
  return trimTrailingSeparators(value).replace(/\\/g, '/')
}

function basename(value: string): string {
  const normalized = trimTrailingSeparators(value)
  const index = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'))
  return index >= 0 ? normalized.slice(index + 1) : normalized
}

function dirname(value: string): string {
  const normalized = trimTrailingSeparators(value)
  const index = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'))
  return index >= 0 ? normalized.slice(0, index) : ''
}

export function isReservedKnowledgeWorkspacePath(path: string, fixedPaths: string[] = []): boolean {
  const normalized = trimTrailingSeparators(path)
  if (!normalized) return false

  if (fixedPaths.some((fixed) => trimTrailingSeparators(fixed) === normalized)) {
    return true
  }

  if (basename(normalized) !== KNOWLEDGE_BASE_NAME) return false
  return LEGACY_KNOWLEDGE_PARENT_NAMES.has(basename(dirname(normalized)))
}

export function filterUserWorkspacePaths(paths: string[], fixedPaths: string[] = []): string[] {
  return paths.filter((path) => !isReservedKnowledgeWorkspacePath(path, fixedPaths))
}

export function findContainingWorkspacePath(
  filePath: string | null | undefined,
  workspacePaths: string[],
): string | null {
  const normalizedFilePath = filePath ? normalizeSeparators(filePath) : ''
  if (!normalizedFilePath) return null

  let bestMatch: { path: string; length: number } | null = null
  for (const workspacePath of workspacePaths) {
    const normalizedWorkspacePath = normalizeSeparators(workspacePath)
    if (!normalizedWorkspacePath) continue
    const containsFile = normalizedFilePath === normalizedWorkspacePath
      || normalizedFilePath.startsWith(`${normalizedWorkspacePath}/`)
    if (containsFile && (!bestMatch || normalizedWorkspacePath.length > bestMatch.length)) {
      bestMatch = { path: workspacePath, length: normalizedWorkspacePath.length }
    }
  }

  return bestMatch?.path ?? null
}
