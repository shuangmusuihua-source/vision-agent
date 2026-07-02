import { realpathSync } from 'fs'
import { randomUUID } from 'crypto'
import { resolve } from 'path'

const ATTACHMENT_GRANT_TTL_MS = 10 * 60 * 1000

interface AttachmentGrant {
  paths: Set<string>
  expiresAt: number
}

const attachmentGrants = new Map<string, AttachmentGrant>()

function canonicalPath(filePath: string): string {
  try {
    return realpathSync.native(resolve(filePath))
  } catch {
    return resolve(filePath)
  }
}

function pruneExpiredGrants(now = Date.now()): void {
  for (const [grantId, grant] of attachmentGrants) {
    if (grant.expiresAt <= now) attachmentGrants.delete(grantId)
  }
}

export function createAttachmentPathGrant(filePaths: string[]): string {
  pruneExpiredGrants()
  const grantId = randomUUID()
  attachmentGrants.set(grantId, {
    paths: new Set(filePaths.map(canonicalPath)),
    expiresAt: Date.now() + ATTACHMENT_GRANT_TTL_MS,
  })
  return grantId
}

export function consumeAttachmentPathGrant(grantId: string | undefined, filePath: string): boolean {
  if (!grantId) return false
  pruneExpiredGrants()
  const grant = attachmentGrants.get(grantId)
  if (!grant) return false

  const authorizedPath = canonicalPath(filePath)
  if (!grant.paths.delete(authorizedPath)) return false
  if (grant.paths.size === 0) attachmentGrants.delete(grantId)
  return true
}
