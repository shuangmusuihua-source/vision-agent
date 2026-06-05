export interface SessionInfo {
  id: string
  createdAt: number
}

const sessions = new Map<string, SessionInfo>()
const MAX_SESSIONS = 50

function evictOldSessions(): void {
  if (sessions.size <= MAX_SESSIONS) return
  const keys = [...sessions.keys()]
  const toDelete = keys.slice(0, sessions.size - MAX_SESSIONS)
  for (const key of toDelete) {
    sessions.delete(key)
  }
}

/** Register a new session and evict oldest if over capacity. */
export function registerSession(sessionId: string): void {
  sessions.set(sessionId, {
    id: sessionId,
    createdAt: Date.now(),
  })
  evictOldSessions()
}

export function getSessionList(): SessionInfo[] {
  return Array.from(sessions.values())
}

export function getSessionInfo(id: string): SessionInfo | undefined {
  return sessions.get(id)
}
