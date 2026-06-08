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
 * 4. `new-*` IDs represent frontend-only sessions not yet materialized by the SDK.
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
  sessionId: string       // "new-{timestamp}" frontend placeholder
  title: string           // user-chosen session name
  workspacePath: string
}

/** SDK assigned a real UUID to a previously-created temp session. */
export interface Materialize {
  type: 'MATERIALIZE'
  tempId: string          // the "new-*" ID being replaced
  realId: string          // SDK-assigned UUID
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
          return { ...s, id: action.realId, lastModified: Date.now() }
        }
        if (s.id === action.realId) {
          return null as unknown as SdkSessionInfo // dedup
        }
        return s
      }).filter(Boolean) as SdkSessionInfo[]

      // Safety net: if the temp entry wasn't in the list (edge case),
      // ensure the real entry exists so the sidebar doesn't lose selection.
      if (!foundTemp) {
        console.warn('[SessionProtocol] MATERIALIZE tempId not found in list, adding realId:', action.realId)
        next.unshift({
          id: action.realId,
          title: undefined,
          workspacePath: undefined,
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
      // - Are not also present in the SDK result (defensive dedup)
      const sdkIds = new Set(action.sessions.map(s => s.id))
      const tempSessions = state.filter(s =>
        s.id.startsWith('new-') &&
        (!action.workspacePath || s.workspacePath === action.workspacePath) &&
        !sdkIds.has(s.id)
      )
      return [...action.sessions, ...tempSessions]
    }
  }
}
