import { getAuthorizedDirectories } from './persistence/workspace-store'
import { getKnowledgeBaseDir } from './persistence/store-core'
import {
  isExactAuthorizedRoot,
  isPathAuthorized as isPathInsideAuthorizedRoots,
} from './agent-path-utils'

export function isPathAuthorized(filePath: string): boolean {
  const dirs = getAuthorizedDirectories()
  const allowedRoots = [...dirs, getKnowledgeBaseDir()]
  return isPathInsideAuthorizedRoots(filePath, allowedRoots)
}

export function isAuthorizedWorkspaceRoot(dirPath: string): boolean {
  return findAuthorizedWorkspaceRoot(dirPath) !== null
}

export function findAuthorizedWorkspaceRoot(dirPath: string): string | null {
  return getAuthorizedDirectories().find((root) => isExactAuthorizedRoot(dirPath, [root])) || null
}

export function isAuthorizedSessionWorkspace(dirPath: string): boolean {
  return isExactAuthorizedRoot(dirPath, [...getAuthorizedDirectories(), getKnowledgeBaseDir()])
}

export function sanitizeFileName(name: string): string {
  return name.replace(/[/\\]/g, '').replace(/\.\./g, '')
}
