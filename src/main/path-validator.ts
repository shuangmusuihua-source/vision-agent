import path from 'path'
import { app } from 'electron'
import { getAuthorizedDirectories } from './store'

let cachedExtraRoots: string[] = []

export function addAuthorizedRoot(p: string): void {
  const resolved = path.resolve(p)
  if (!cachedExtraRoots.includes(resolved)) {
    cachedExtraRoots.push(resolved)
  }
}

export function isPathAuthorized(filePath: string): boolean {
  const resolved = path.resolve(filePath)
  const dirs = getAuthorizedDirectories()
  const allowedRoots = [...dirs, ...cachedExtraRoots, app.getPath('temp'), app.getPath('userData')]
  return allowedRoots.some((root) => {
    const resolvedRoot = path.resolve(root)
    return resolved === resolvedRoot || resolved.startsWith(resolvedRoot + path.sep)
  })
}

export function sanitizeFileName(name: string): string {
  return name.replace(/[/\\]/g, '').replace(/\.\./g, '')
}