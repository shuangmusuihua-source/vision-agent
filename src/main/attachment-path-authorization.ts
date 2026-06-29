import { realpathSync } from 'fs'
import { resolve } from 'path'

const authorizedAttachmentPaths = new Set<string>()

function canonicalPath(filePath: string): string {
  try {
    return realpathSync.native(resolve(filePath))
  } catch {
    return resolve(filePath)
  }
}

export function authorizeAttachmentPaths(filePaths: string[]): void {
  filePaths.forEach(filePath => authorizedAttachmentPaths.add(canonicalPath(filePath)))
}

export function isAttachmentPathAuthorized(filePath: string): boolean {
  return authorizedAttachmentPaths.has(canonicalPath(filePath))
}

