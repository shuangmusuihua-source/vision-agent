import type { SessionPageCursor } from '../shared/types'

const MAX_SESSION_PAGE_SIZE = 200
const SESSION_PAGE_CURSOR_PATTERN = /^(jsonl|sdk):([1-9]\d*)$/
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,200}$/

export function isSafeAppSessionId(sessionId: string): boolean {
  return SESSION_ID_PATTERN.test(sessionId)
}

export function isSafeSdkSessionId(sessionId: string): boolean {
  return SESSION_ID_PATTERN.test(sessionId)
}

export function normalizeSessionPage(
  limit: number,
  cursor: unknown,
): { limit: number; cursor: SessionPageCursor } | null {
  const safeLimit = Number.isFinite(limit) ? Math.floor(limit) : 1
  if (cursor === null || cursor === undefined) {
    return {
      limit: Math.min(MAX_SESSION_PAGE_SIZE, Math.max(1, safeLimit)),
      cursor: null,
    }
  }
  if (typeof cursor !== 'string') return null
  const match = cursor.match(SESSION_PAGE_CURSOR_PATTERN)
  if (!match || !Number.isSafeInteger(Number(match[2]))) return null
  return {
    limit: Math.min(MAX_SESSION_PAGE_SIZE, Math.max(1, safeLimit)),
    cursor,
  }
}
