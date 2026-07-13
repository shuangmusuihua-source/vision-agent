import { app } from 'electron'
import { getAuthorizedDirectories } from './persistence/workspace-store'
import { getKnowledgeBaseDir } from './persistence/store-core'
import { isPathAuthorized as isPathInsideAuthorizedRoots } from './agent-path-utils'
import { getAppUserDataDir } from './app-identity'

export function isPathAuthorized(filePath: string): boolean {
  const dirs = getAuthorizedDirectories()
  const allowedRoots = [...dirs, getKnowledgeBaseDir(), app.getPath('temp'), getAppUserDataDir()]
  return isPathInsideAuthorizedRoots(filePath, allowedRoots)
}

export function sanitizeFileName(name: string): string {
  return name.replace(/[/\\]/g, '').replace(/\.\./g, '')
}
