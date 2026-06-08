import type { AgentContext } from '../shared/types'

export interface SessionInfo {
  id: string
  createdAt: number
  workspacePath?: string
  title?: string
  lastModified?: number
  messageCount?: number
  context?: AgentContext
}

const sessions = new Map<string, SessionInfo>()
const MAX_SESSIONS = 200

function evictOldSessions(): void {
  if (sessions.size <= MAX_SESSIONS) return
  // Sort by createdAt ascending (oldest first)
  const entries = [...sessions.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt)
  // Evict oldest entries; prefer evicting entries without workspacePath
  const toDelete = entries
    .filter(([, info]) => !info.workspacePath)
    .slice(0, sessions.size - MAX_SESSIONS)

  // If not enough un-workspaced entries, also evict oldest workspaced ones
  if (toDelete.length < sessions.size - MAX_SESSIONS) {
    const remaining = entries
      .filter(([, info]) => info.workspacePath)
      .slice(0, sessions.size - MAX_SESSIONS - toDelete.length)
    toDelete.push(...remaining)
  }

  for (const [key] of toDelete) {
    sessions.delete(key)
  }
}

/** Register a new session, optionally tagged with workspace path. */
export function registerSession(sessionId: string, workspacePath?: string): void {
  sessions.set(sessionId, {
    id: sessionId,
    createdAt: Date.now(),
    workspacePath,
  })
  evictOldSessions()
}

/** Update an existing session's metadata in the in-memory registry. */
export function updateSession(sessionId: string, patch: Partial<Omit<SessionInfo, 'id'>>): void {
  const existing = sessions.get(sessionId)
  if (existing) {
    sessions.set(sessionId, { ...existing, ...patch })
  }
}

/** Get sessions belonging to a specific workspace. */
export function getSessionsByWorkspace(workspacePath: string): SessionInfo[] {
  return Array.from(sessions.values()).filter(s => s.workspacePath === workspacePath)
}

export function getSessionInfo(id: string): SessionInfo | undefined {
  return sessions.get(id)
}
