/**
 * Session Protocol — single source of truth for sessionList mutations.
 *
 * Every write to sessionList MUST go through `dispatchSessionList`.
 * No code may call `setState({ sessionList: ... })` directly.
 *
 * Design principles:
 * 1. Session list is the **authoritative inventory** of user-facing sessions.
 * 2. Each action type maps to one user intent (create, send-first-message, delete).
 * 3. Invariants are enforced by a pure reducer — no ad-hoc list manipulation.
 * 4. `id` is app-owned and stable. `sdkSessionId` is the Claude SDK handle.
 *    Materialization attaches `sdkSessionId`; it must not rename `id`.
 * 5. `messageCount` carries real SDK data (populated by `listSdkSessions` in
 *    agent-manager.ts). It flows through CREATE_TEMP (set to 0), MATERIALIZE
 *    (spread-preserved), and REPLACE_SDK (passed through from SDK sessions)
 *    unchanged — the reducer never mutates it.
 */

import type { SdkSessionInfo } from '../../shared/types'

const isTempSession = (session: SdkSessionInfo) => session.id.startsWith('new-')

const sessionWorkspacePath = (session: SdkSessionInfo): string | undefined => {
  if (session.workspacePath) return session.workspacePath
  if (session.context === 'ask') return undefined
  return session.cwd
}

const sessionMatches = (a: SdkSessionInfo, b: SdkSessionInfo): boolean => {
  return a.id === b.id ||
    (!!a.sdkSessionId && (a.sdkSessionId === b.sdkSessionId || a.sdkSessionId === b.id)) ||
    (!!b.sdkSessionId && (b.sdkSessionId === a.sdkSessionId || b.sdkSessionId === a.id))
}

const mergeSession = (existing: SdkSessionInfo, incoming: SdkSessionInfo): SdkSessionInfo => {
  return {
    ...existing,
    ...incoming,
    id: existing.id,
    sdkSessionId: incoming.sdkSessionId ?? existing.sdkSessionId,
    workspacePath: incoming.workspacePath ?? existing.workspacePath,
    context: incoming.context ?? existing.context,
    cwd: incoming.cwd ?? existing.cwd,
    title: existing.title ?? incoming.title,
  }
}

// ─── Actions ──────────────────────────────────────────────────────────────

export type SessionListAction =
  | CreateTemp
  | Materialize
  | Rename
  | Delete
  | ReplaceSdk

/** User clicked "new conversation" and typed a name. */
export interface CreateTemp {
  type: 'CREATE_TEMP'
  sessionId: string       // app-owned stable session key
  title: string           // user-chosen session name
  workspacePath: string
}

/** SDK assigned a real UUID to a previously-created app session. */
export interface Materialize {
  type: 'MATERIALIZE'
  tempId: string          // app-owned stable session key
  realId: string          // SDK-assigned UUID
  context?: SdkSessionInfo['context']
  workspacePath?: string
  title?: string
}

/** User deleted a session (or the SDK confirmed deletion). */
export interface Delete {
  type: 'DELETE'
  sessionId: string
}

/** User renamed an app-owned session. */
export interface Rename {
  type: 'RENAME'
  sessionId: string
  title: string
}

/** loadSessions() returned fresh data from the SDK on workspace change. */
export interface ReplaceSdk {
  type: 'REPLACE_SDK'
  sessions: SdkSessionInfo[]   // Authoritative list from SDK for current workspace
  workspacePath?: string       // Only temp sessions for THIS workspace are retained
}

// ─── Reducer ──────────────────────────────────────────────────────────────

export function sessionListReducer(
  state: SdkSessionInfo[],
  action: SessionListAction
): SdkSessionInfo[] {
  switch (action.type) {
    // ── User created a new session ─────────────────────────────────
    case 'CREATE_TEMP': {
      // Prepend — newest session first. Dedup by id (defensive).
      return [
        {
          id: action.sessionId,
          title: action.title,
          workspacePath: action.workspacePath,
          createdAt: Date.now(),
          lastModified: Date.now(),
          messageCount: 0,
        },
        ...state.filter(s => s.id !== action.sessionId),
      ]
    }

    // ── First message sent → SDK assigned real UUID ────────────────
    case 'MATERIALIZE': {
      let foundTemp = false
      const next = state.map(s => {
        if (s.id === action.tempId) {
          foundTemp = true
          return {
            ...s,
            sdkSessionId: action.realId,
            context: action.context ?? s.context,
            workspacePath: action.workspacePath ?? s.workspacePath,
            title: action.title ?? s.title,
            lastModified: Date.now(),
          }
        }
        if (s.id === action.realId || s.sdkSessionId === action.realId) {
          return null as unknown as SdkSessionInfo // dedup
        }
        return s
      }).filter(Boolean) as SdkSessionInfo[]

      // Safety net: if the app session wasn't in the list, keep a stable
      // app-facing id and attach the SDK id. Do not warn here; Ask sumi and
      // unnamed editor sends can materialize without a sidebar-created entry.
      if (!foundTemp) {
        next.unshift({
          id: action.tempId || action.realId,
          sdkSessionId: action.realId,
          title: action.title,
          workspacePath: action.workspacePath,
          context: action.context,
          createdAt: Date.now(),
          lastModified: Date.now(),
          messageCount: 0,
        })
      }
      return next
    }

    // ── User deleted a session ─────────────────────────────────────
    case 'DELETE': {
      return state.filter(s => s.id !== action.sessionId)
    }

    case 'RENAME': {
      return state.map((session) => (
        session.id === action.sessionId ? { ...session, title: action.title } : session
      ))
    }

    // ── Workspace changed → reload from SDK ────────────────────────
    case 'REPLACE_SDK': {
      if (state.length === 0) return action.sessions

      const isInRefreshScope = (session: SdkSessionInfo): boolean => {
        const workspacePath = sessionWorkspacePath(session)
        if (action.workspacePath) return workspacePath === action.workspacePath
        return !workspacePath || session.context === 'ask'
      }

      const incoming = action.sessions.filter(isInRefreshScope)
      const usedIncoming = new Set<number>()
      const next: SdkSessionInfo[] = []

      for (const existing of state) {
        if (!isInRefreshScope(existing)) {
          next.push(existing)
          continue
        }

        const incomingIndex = incoming.findIndex((candidate, index) =>
          !usedIncoming.has(index) && sessionMatches(existing, candidate)
        )

        if (incomingIndex >= 0) {
          usedIncoming.add(incomingIndex)
          next.push(mergeSession(existing, incoming[incomingIndex]))
        } else if (isTempSession(existing)) {
          next.push(existing)
        }
      }

      for (let index = 0; index < incoming.length; index += 1) {
        if (!usedIncoming.has(index)) next.push(incoming[index])
      }

      for (const candidate of action.sessions) {
        if (isInRefreshScope(candidate)) continue
        if (state.some(existing => sessionMatches(existing, candidate))) continue
        next.push(candidate)
      }

      return next
    }
  }
}
