const MAX_SESSION_PAGE_SIZE = 200

export function isSafeSdkSessionId(sessionId: string): boolean {
  return /^[A-Za-z0-9_-]{1,200}$/.test(sessionId)
}

export function normalizeSessionPage(limit: number, offset: number): { limit: number; offset: number } {
  const safeLimit = Number.isFinite(limit) ? Math.floor(limit) : 1
  const safeOffset = Number.isFinite(offset) ? Math.floor(offset) : 0
  return {
    limit: Math.min(MAX_SESSION_PAGE_SIZE, Math.max(1, safeLimit)),
    offset: Math.max(0, safeOffset),
  }
}
