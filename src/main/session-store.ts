import { listSessions, getSessionMessages, renameSession, deleteSession, getSessionInfo, tagSession, forkSession as sdkForkSession } from '@anthropic-ai/claude-agent-sdk'
import type { ForkSessionOptions, SessionMutationOptions } from '@anthropic-ai/claude-agent-sdk'
import { getAppSkillsCwd } from './skill-init'
import { toAgentIPCMessage } from './message-converter'
import type { AgentIPCMessage } from '../shared/types'
import { getSessionRecords, removeSessionRecord, getCompactionSessionIds, addCompactionSessionId, deleteCompactionSessionId } from './store'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'

// ─── Compaction tracking ───────────────────────────────────────────────
// Track session IDs created by SDK mid-stream compaction.
// When the SDK compacts a long conversation, it creates a new session file
// on disk with a different session_id. These are internal forks that should
// NOT appear as user-facing sessions in the sidebar.
// Initialized from electron-store to survive app restarts.

const MAX_COMPACTION_IDS = 200

const compactionSessionIds = new Set<string>(getCompactionSessionIds())

/** Add a compaction fork ID to the in-memory set (called by query-runner during streaming). */
export function addCompactionId(id: string): void {
  // Enforce upper bound to prevent unbounded growth.
  // Set maintains insertion order, so for...of yields oldest entries first.
  if (compactionSessionIds.size >= MAX_COMPACTION_IDS) {
    let toRemove = compactionSessionIds.size - MAX_COMPACTION_IDS + 1
    for (const oldId of compactionSessionIds) {
      if (toRemove <= 0) break
      compactionSessionIds.delete(oldId)
      toRemove--
    }
  }
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

    const globalCwd = getAppSkillsCwd()
    const results: Array<{ id: string; title?: string; createdAt?: number; lastModified?: number; messageCount?: number; cwd?: string; workspacePath?: string; context?: string }> = []
    const seenIds = new Set<string>()

    try {
      const globalResult = await listSessions({ dir: globalCwd })
      for (const s of globalResult) {
        if (!seenIds.has(s.sessionId)) {
          seenIds.add(s.sessionId)
          if (compactionSessionIds.has(s.sessionId)) continue
          results.push({
            id: s.sessionId,
            title: s.customTitle || sessionTitleMap.get(s.sessionId) || s.summary || s.firstPrompt,
            createdAt: s.createdAt,
            lastModified: s.lastModified,
            messageCount: (s as Record<string, unknown>).messageCount as number || 0,
            cwd: globalCwd,
            workspacePath: sessionWorkspaceMap.get(s.sessionId),
            context: sessionContextMap.get(s.sessionId),
          })
        }
      }
    } catch (err) {
      console.error('[SessionStore] listSessions global error:', err)
    }

    if (workspaceCwd && workspaceCwd !== globalCwd) {
      try {
        const wsResult = await listSessions({ dir: workspaceCwd })
        for (const s of wsResult) {
          if (!seenIds.has(s.sessionId)) {
            seenIds.add(s.sessionId)
            if (compactionSessionIds.has(s.sessionId)) continue
            results.push({
              id: s.sessionId,
              title: s.customTitle || sessionTitleMap.get(s.sessionId) || s.summary || s.firstPrompt,
              createdAt: s.createdAt,
              lastModified: s.lastModified,
              messageCount: (s as Record<string, unknown>).messageCount as number || 0,
              cwd: workspaceCwd,
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
    // Exclude ask-context sessions — they belong to Ask Zuovis, not the workspace.
    // No workspace-path filter — the sidebar groups sessions by workspacePath itself.
    return results.filter(s => s.context !== 'ask')
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

/**
 * Read session JSONL directly from disk, bypassing the SDK API which
 * truncates pre-compaction messages. SDK stores sessions at:
 *   {userData}/.claude/projects/{workspacePath with /→-}/{sessionId}.jsonl
 */
function readSessionJsonlDirect(sessionId: string): Array<Record<string, unknown>> | null {
  try {
    const records = getSessionRecords()
    const record = records.find(r => r.id === sessionId)
    const wsPath = record?.workspacePath
    if (!wsPath) return null

    const sanitized = wsPath.replace(/\//g, '-')
    const jsonlPath = join(app.getPath('userData'), '.claude', 'projects', sanitized, `${sessionId}.jsonl`)
    if (!existsSync(jsonlPath)) return null

    const raw = readFileSync(jsonlPath, 'utf-8')
    const lines = raw.trim().split('\n')
    return lines.map(line => {
      try { return JSON.parse(line) as Record<string, unknown> }
      catch { return null }
    }).filter(Boolean) as Array<Record<string, unknown>>
  } catch (err) {
    console.error('[SessionStore] Direct JSONL read failed:', (err as Error).message)
    return null
  }
}

export async function loadSdkSessionMessages(
  sessionId: string,
  limit?: number,
  offset?: number
): Promise<Array<Record<string, unknown>>> {
  // Direct JSONL read returns ALL messages including pre-compaction history.
  const direct = readSessionJsonlDirect(sessionId)
  if (direct) {
    const start = offset ?? 0
    const end = limit != null ? start + limit : undefined
    return direct.slice(start, end)
  }

  // Fallback to SDK API (for edge cases where direct read can't find the file)
  try {
    const options: Record<string, unknown> = { includeSystemMessages: true }
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
  // Direct JSONL read — SDK API truncates pre-compaction messages.
  const direct = readSessionJsonlDirect(sessionId)
  const rawMessages = direct
    ? direct.slice(offset, offset + limit)
    : await getSessionMessages(sessionId, { limit, offset, includeSystemMessages: true })

  const messages: AgentIPCMessage[] = []
  for (const m of rawMessages) {
    const converted = toAgentIPCMessage(m as any)
    if (converted) messages.push(converted)
  }
  return { messages, offset, limit }
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

// ─── SDK Session Operations ──────────────────────────────────────────────

export async function tagSdkSession(sessionId: string, tag: string): Promise<boolean> {
  try {
    const cwd = getAppSkillsCwd()
    const opts: SessionMutationOptions = { dir: cwd }
    await tagSession(sessionId, tag, opts)
    return true
  } catch {
    return false
  }
}

export async function getSdkSessionInfo(sessionId: string): Promise<Record<string, unknown> | null> {
  try {
    const cwd = getAppSkillsCwd()
    const info = await getSessionInfo(sessionId, { dir: cwd })
    return info as Record<string, unknown>
  } catch {
    return null
  }
}

export async function forkSdkSession(sessionId: string, options?: ForkSessionOptions): Promise<{ sessionId: string } | null> {
  try {
    const cwd = getAppSkillsCwd()
    const result = await sdkForkSession(sessionId, { ...options, dir: cwd } as ForkSessionOptions)
    return result as { sessionId: string } | null
  } catch {
    return null
  }
}

export async function loadSdkSessionMessagesTyped(sessionId: string): Promise<AgentIPCMessage[]> {
  try {
    const cwd = getAppSkillsCwd()
    const raw = await getSessionMessages(sessionId, { dir: cwd })
    if (!Array.isArray(raw)) return []
    return raw.map(m => toAgentIPCMessage(m as any)).filter((m): m is AgentIPCMessage => m !== null)
  } catch {
    return []
  }
}
