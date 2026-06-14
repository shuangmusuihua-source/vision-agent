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

// ─── Actions ──────────────────────────────────────────────────────────────

export type SessionListAction =
  | CreateTemp
  | Materialize
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
      // app-facing id and attach the SDK id. Do not warn here; Ask Zuovis and
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

    // ── Workspace changed → reload from SDK ────────────────────────
    case 'REPLACE_SDK': {
      // Preserve temp sessions that:
      // - Belong to the current workspace (or any workspace if none specified)
      // - May already be materialized; in that case they suppress the SDK
      //   duplicate so the app-owned id remains stable.
      const tempSessions = state.filter(s =>
        s.id.startsWith('new-') &&
        (!action.workspacePath || s.workspacePath === action.workspacePath)
      )
      const retainedSdkIds = new Set(tempSessions.map(s => s.sdkSessionId).filter(Boolean) as string[])
      const sdkSessions = action.sessions.filter(s => !retainedSdkIds.has(s.sdkSessionId || s.id))
      return [...sdkSessions, ...tempSessions]
    }
  }
}
