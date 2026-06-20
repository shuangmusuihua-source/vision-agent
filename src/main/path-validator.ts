import path from 'path'
import { app } from 'electron'
import { getAuthorizedDirectories } from './store'
import { isPathAuthorized as isPathInsideAuthorizedRoots } from './agent-path-utils'
import { getAppUserDataDir } from './app-identity'

let cachedExtraRoots: string[] = []

export function addAuthorizedRoot(p: string): void {
  const resolved = path.resolve(p)
  if (!cachedExtraRoots.includes(resolved)) {
    cachedExtraRoots.push(resolved)
  }
}

export function isPathAuthorized(filePath: string): boolean {
  const dirs = getAuthorizedDirectories()
  const allowedRoots = [...dirs, ...cachedExtraRoots, app.getPath('temp'), getAppUserDataDir()]
  return isPathInsideAuthorizedRoots(filePath, allowedRoots)
}

export function sanitizeFileName(name: string): string {
  return name.replace(/[/\\]/g, '').replace(/\.\./g, '')
}
