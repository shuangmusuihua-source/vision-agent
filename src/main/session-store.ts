import { listSessions, getSessionMessages, renameSession, deleteSession } from '@anthropic-ai/claude-agent-sdk'
import { getAppSkillsCwd } from './skill-init'
import { toAgentIPCMessage } from './message-converter'
import type { AgentIPCMessage } from '../shared/types'
import { getSessionRecords, removeSessionRecord, getCompactionSessionIds, addCompactionSessionId, deleteCompactionSessionId } from './store'

// ─── Compaction tracking ───────────────────────────────────────────────
// Track session IDs created by SDK mid-stream compaction.
// When the SDK compacts a long conversation, it creates a new session file
// on disk with a different session_id. These are internal forks that should
// NOT appear as user-facing sessions in the sidebar.
// Initialized from electron-store to survive app restarts.

const compactionSessionIds = new Set<string>(getCompactionSessionIds())

/** Add a compaction fork ID to the in-memory set (called by query-runner during streaming). */
export function addCompactionId(id: string): void {
  compactionSessionIds.add(id)
}

// ─── SDK session listing ───────────────────────────────────────────────

export async function listSdkSessions(workspaceCwd?: string): Promise<Array<{ id: string; title?: string; createdAt?: number; lastModified?: number; messageCount?: number; cwd?: string; workspacePath?: string; context?: string }>> {
  try {
    // Build session→workspace + context + title maps from electron-store SessionRecords
    const records = getSessionRecords()
    const sessionWorkspaceMap = new Map<string, string>()
    const sessionContextMap = new Map<string, string>()
    const sessionTitleMap = new Map<string, string>()
    for (const r of records) {
      if (r.workspacePath) sessionWorkspaceMap.set(r.id, r.workspacePath)
      sessionContextMap.set(r.id, r.context)
      if (r.title) sessionTitleMap.set(r.id, r.title)
    }

    // Query both global (userData) and workspace-specific sessions
    const globalCwd = getAppSkillsCwd()
    const results: Array<{ id: string; title?: string; createdAt?: number; lastModified?: number; messageCount?: number; cwd?: string; workspacePath?: string; context?: string }> = []
    const seenIds = new Set<string>()

    // Always query global (legacy sessions + app-level)
    try {
      const globalResult = await listSessions({ dir: globalCwd })
      for (const s of globalResult) {
        if (!seenIds.has(s.sessionId)) {
          seenIds.add(s.sessionId)
          // Skip SDK compaction forks — these are internal, not user-facing
          if (compactionSessionIds.has(s.sessionId)) continue
          results.push({
            id: s.sessionId,
            title: s.customTitle || sessionTitleMap.get(s.sessionId) || s.summary || s.firstPrompt,
            createdAt: s.createdAt,
            lastModified: s.lastModified,
            messageCount: (s as Record<string, unknown>).messageCount as number || 0,
            cwd: globalCwd,
            // SessionRecord provides the canonical workspace mapping.
            // No fallback for global sessions — they could belong to any workspace.
            workspacePath: sessionWorkspaceMap.get(s.sessionId),
            context: sessionContextMap.get(s.sessionId),
          })
        }
      }
    } catch (err) {
      console.error('[SessionStore] listSessions global error:', err)
    }

    // Also query workspace-specific if different from global
    if (workspaceCwd && workspaceCwd !== globalCwd) {
      try {
        const wsResult = await listSessions({ dir: workspaceCwd })
        for (const s of wsResult) {
          if (!seenIds.has(s.sessionId)) {
            seenIds.add(s.sessionId)
            // Skip SDK compaction forks — these are internal, not user-facing
            if (compactionSessionIds.has(s.sessionId)) continue
            results.push({
              id: s.sessionId,
              title: s.customTitle || sessionTitleMap.get(s.sessionId) || s.summary || s.firstPrompt,
              createdAt: s.createdAt,
              lastModified: s.lastModified,
              messageCount: (s as Record<string, unknown>).messageCount as number || 0,
              cwd: workspaceCwd,
              // Session found in the workspace-specific directory is owned by
              // this workspace. SessionRecord can override with a different path.
              workspacePath: sessionWorkspaceMap.get(s.sessionId) || workspaceCwd,
              context: sessionContextMap.get(s.sessionId),
            })
          }
        }
      } catch (err) {
        console.error('[SessionStore] listSessions workspace error:', err)
      }
    }

    // Augment with empty named sessions from SessionRecords that were
    // created but never had a message sent — they have no SDK session yet.
    for (const r of records) {
      if (!seenIds.has(r.id) && r.id && r.workspacePath) {
        seenIds.add(r.id)
        results.push({
          id: r.id,
          title: r.title || r.firstPrompt,
          createdAt: r.createdAt,
          lastModified: r.lastModified,
          messageCount: r.messageCount || 0,
          cwd: globalCwd,
          workspacePath: r.workspacePath,
          context: r.context,
        })
      }
    }

    // If workspace filter is requested, filter by workspacePath from SessionRecords
    // Exclude ask-context sessions — they belong to Ask Zuovis, not the workspace
    if (workspaceCwd) {
      return results.filter(s => s.workspacePath === workspaceCwd && s.context !== 'ask')
    }

    return results
  } catch (err) {
    console.error('[SessionStore] listSessions error:', err)
    return []
  }
}

export async function getSdkSessionTotalMessageCount(
  sessionId: string,
  workspaceCwd?: string
): Promise<number> {
  try {
    const dirs = [getAppSkillsCwd()]
    if (workspaceCwd) dirs.push(workspaceCwd)
    const seenIds = new Set<string>()
    const compactionIds = compactionSessionIds
    for (const dir of dirs) {
      try {
        const sessions = await listSessions({ dir })
        for (const s of sessions) {
          if (seenIds.has(s.sessionId)) continue
          seenIds.add(s.sessionId)
          if (compactionIds.has(s.sessionId)) continue
          if (s.sessionId === sessionId) {
            return ((s as Record<string, unknown>).messageCount as number) || 0
          }
        }
      } catch {
        // Continue to the next dir
      }
    }
    return 0
  } catch (err) {
    console.error('[SessionStore] getSdkSessionTotalMessageCount error:', err)
    return 0
  }
}

export async function loadSdkSessionMessages(
  sessionId: string,
  limit?: number,
  offset?: number
): Promise<Array<Record<string, unknown>>> {
  try {
    const options: Record<string, unknown> = {}
    if (limit !== undefined) options.limit = limit
    if (offset !== undefined) options.offset = offset
    const messages = await getSessionMessages(sessionId, options)
    return messages.map((m) => m as unknown as Record<string, unknown>)
  } catch (err) {
    console.error('[SessionStore] getSessionMessages error:', err)
    return []
  }
}

export async function loadSdkSessionMessagesPaginated(
  sessionId: string,
  limit: number,
  offset: number
): Promise<{ messages: AgentIPCMessage[]; offset: number; limit: number }> {
  try {
    const sdkMessages = await getSessionMessages(sessionId, { limit, offset })
    const messages: AgentIPCMessage[] = []
    for (const m of sdkMessages) {
      const converted = toAgentIPCMessage(m as any)
      if (converted) messages.push(converted)
    }
    return { messages, offset, limit }
  } catch (err) {
    console.error('[SessionStore] loadSdkSessionMessagesPaginated error:', err)
    return { messages: [], offset, limit }
  }
}

export async function renameSdkSession(sessionId: string, title: string): Promise<void> {
  try {
    await renameSession(sessionId, title)
  } catch (err) {
    console.error('[SessionStore] renameSession error:', err)
    throw err
  }
}

/**
 * Delete a session from SDK storage and clean up tracking metadata.
 * Callers MUST abort any running query for this session BEFORE calling this
 * function — query-runner.abortActiveQuery(sessionId) should be called first.</summary>
*/
export async function deleteSdkSession(sessionId: string): Promise<void> {
  // Delete from SDK storage first — the critical operation.
  // Only clean up tracking metadata after it succeeds, so a failed
  // deletion leaves the session intact rather than orphaned.
  await deleteSession(sessionId)
  compactionSessionIds.delete(sessionId)
  deleteCompactionSessionId(sessionId)
  removeSessionRecord(sessionId)
}
