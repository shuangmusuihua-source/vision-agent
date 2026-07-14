import { realpathSync, statSync } from 'fs'
import { resolve } from 'path'

const DIRECTORY_GRANT_TTL_MS = 10 * 60 * 1000
const selectedDirectoryGrants = new Map<string, number>()

function canonicalDirectory(dirPath: string): string {
  const canonical = realpathSync.native(resolve(dirPath))
  if (!statSync(canonical).isDirectory()) throw new Error('Path is not a directory')
  return canonical
}

export function rememberSelectedDirectoryGrant(dirPath: string, now = Date.now()): void {
  selectedDirectoryGrants.set(canonicalDirectory(dirPath), now + DIRECTORY_GRANT_TTL_MS)
}

export function consumeSelectedDirectoryGrant(dirPath: string, now = Date.now()): boolean {
  let canonical: string
  try {
    canonical = canonicalDirectory(dirPath)
  } catch {
    return false
  }
  const expiresAt = selectedDirectoryGrants.get(canonical)
  selectedDirectoryGrants.delete(canonical)
  return typeof expiresAt === 'number' && expiresAt >= now
}

export function canonicalGrantedDirectory(dirPath: string): string {
  return canonicalDirectory(dirPath)
}
