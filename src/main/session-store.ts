import { listSessions, getSessionMessages, renameSession, deleteSession, getSessionInfo, tagSession, forkSession as sdkForkSession } from '@anthropic-ai/claude-agent-sdk'
import type { ForkSessionOptions, SessionMutationOptions } from '@anthropic-ai/claude-agent-sdk'
import { getAppSkillsCwd } from './skill-init'
import { toAgentIPCMessage } from './message-converter'
import type { AgentIPCMessage, SdkSessionInfo } from '../shared/types'
import { getSessionRecords, removeSessionRecord, getCompactionSessionIds, addCompactionSessionId, deleteCompactionSessionId } from './store'
import { readFileSync, existsSync } from 'fs'
import { resolveClaudeSessionJsonlPath } from './claude-session-path'

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

function getRecordForSession(sessionId: string) {
  return getSessionRecords().find(r => r.id === sessionId || r.sdkSessionId === sessionId)
}

function getSdkSessionId(sessionId: string): string {
  return getRecordForSession(sessionId)?.sdkSessionId || sessionId
}

function getAppSessionId(sessionId: string): string {
  return getRecordForSession(sessionId)?.id || sessionId
}

function getSessionDir(sessionId: string): string | undefined {
  const record = getRecordForSession(sessionId)
  if (record?.workspacePath) return record.workspacePath
  if (record?.context === 'ask') return getAppSkillsCwd()
  return undefined
}

function getSessionMutationOptions(sessionId: string): SessionMutationOptions | undefined {
  const dir = getSessionDir(sessionId)
  return dir ? { dir } : undefined
}

// ─── SDK session listing ───────────────────────────────────────────────

export async function listSdkSessions(workspaceCwd?: string): Promise<SdkSessionInfo[]> {
  try {
    // Build session→workspace + context + title maps from electron-store SessionRecords
    const records = getSessionRecords()
    const sessionWorkspaceMap = new Map<string, string>()
    const sessionContextMap = new Map<string, string>()
    const sessionTitleMap = new Map<string, string>()
    const sessionAppIdMap = new Map<string, string>()
    for (const r of records) {
      const sdkId = r.sdkSessionId || r.id
      if (r.workspacePath) sessionWorkspaceMap.set(sdkId, r.workspacePath)
      sessionContextMap.set(sdkId, r.context)
      sessionAppIdMap.set(sdkId, r.id)
      if (r.title) sessionTitleMap.set(sdkId, r.title)
    }

    const globalCwd = getAppSkillsCwd()
    const results: SdkSessionInfo[] = []
    const seenIds = new Set<string>()

    try {
      const globalResult = await listSessions({ dir: globalCwd })
      for (const s of globalResult) {
        if (!seenIds.has(s.sessionId)) {
          seenIds.add(s.sessionId)
          if (compactionSessionIds.has(s.sessionId)) continue
          const appId = sessionAppIdMap.get(s.sessionId) || s.sessionId
          results.push({
            id: appId,
            sdkSessionId: s.sessionId,
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
            const appId = sessionAppIdMap.get(s.sessionId) || s.sessionId
            results.push({
              id: appId,
              sdkSessionId: s.sessionId,
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
    const seenAppIds = new Set(results.map(r => r.id))
    for (const r of records) {
      if (!seenAppIds.has(r.id) && r.id && r.workspacePath) {
        seenAppIds.add(r.id)
        results.push({
          id: r.id,
          sdkSessionId: r.sdkSessionId,
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

    // Return both entry types. The renderer separates Ask Zuovis sessions
    // from workspace sessions by context so the two entry points stay isolated.
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
    const sdkSessionId = getSdkSessionId(sessionId)
    const dirs = [getAppSkillsCwd()]
    const sessionDir = getSessionDir(sessionId)
    if (sessionDir && !dirs.includes(sessionDir)) dirs.push(sessionDir)
    if (workspaceCwd && !dirs.includes(workspaceCwd)) dirs.push(workspaceCwd)
    const seenIds = new Set<string>()
    const compactionIds = compactionSessionIds
    for (const dir of dirs) {
      try {
        const sessions = await listSessions({ dir })
        for (const s of sessions) {
          if (seenIds.has(s.sessionId)) continue
          seenIds.add(s.sessionId)
          if (compactionIds.has(s.sessionId)) continue
          if (s.sessionId === sdkSessionId) {
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
    const record = getRecordForSession(sessionId)
    const fileSessionId = getSdkSessionId(sessionId)
    const jsonlPath = resolveClaudeSessionJsonlPath(fileSessionId, record?.workspacePath)

    if (!jsonlPath || !existsSync(jsonlPath)) return null

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
    const sdkSessionId = getSdkSessionId(sessionId)
    const options: Record<string, unknown> = { includeSystemMessages: true }
    const dir = getSessionDir(sessionId)
    if (dir) options.dir = dir
    if (limit !== undefined) options.limit = limit
    if (offset !== undefined) options.offset = offset
    const messages = await getSessionMessages(sdkSessionId, options)
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
): Promise<{ messages: AgentIPCMessage[]; offset: number; limit: number; hasMore: boolean }> {
  // Direct JSONL read — SDK API truncates pre-compaction messages.
  // JSONL is append-only (oldest → newest). We read backward:
  //   offset=0 → newest messages (from end of file)
  //   offset>0 → older messages before the current window (backward)
  const direct = readSessionJsonlDirect(sessionId)
  let nextOffset = offset
  if (direct && direct.length > 0) {
    let slice: Array<Record<string, unknown>>
    if (offset === 0) {
      // Initial load: newest messages from the tail.
      const startIdx = Math.max(0, direct.length - limit)
      slice = direct.slice(startIdx)
      nextOffset = startIdx
    } else {
      // Load more: older messages before the current window.
      const startIdx = Math.max(0, offset - limit)
      slice = direct.slice(startIdx, offset)
      nextOffset = startIdx
    }
    const messages: AgentIPCMessage[] = []
    for (const m of slice) {
      const converted = toAgentIPCMessage(m as any)
      if (converted) messages.push(converted)
    }
    return { messages, offset: nextOffset, limit, hasMore: nextOffset > 0 }
  }

  // Fallback to SDK API — used only when direct JSONL read fails
  // (no workspacePath in session record). SDK API uses forward pagination
  // (oldest→newest, offset increases); the direct path uses backward
  // (newest→oldest, offset decreases).  This fallback does NOT match the
  // direct path's "newest first" behavior for initial load — it returns
  // the oldest messages instead.  Acceptable because this path is rarely hit.
  const dir = getSessionDir(sessionId)
  const sdkMessages = await getSessionMessages(getSdkSessionId(sessionId), {
    limit,
    offset,
    includeSystemMessages: true,
    ...(dir ? { dir } : {}),
  })
  const messages: AgentIPCMessage[] = []
  for (const m of sdkMessages) {
    const converted = toAgentIPCMessage(m as any)
    if (converted) messages.push(converted)
  }
  return { messages, offset: offset + sdkMessages.length, limit, hasMore: sdkMessages.length >= limit }
}

export async function renameSdkSession(sessionId: string, title: string): Promise<void> {
  try {
    await renameSession(getSdkSessionId(sessionId), title, getSessionMutationOptions(sessionId))
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
  const sdkSessionId = getSdkSessionId(sessionId)
  const appSessionId = getAppSessionId(sessionId)
  await deleteSession(sdkSessionId, getSessionMutationOptions(sessionId))
  compactionSessionIds.delete(sdkSessionId)
  deleteCompactionSessionId(sdkSessionId)
  removeSessionRecord(appSessionId)
}

// ─── SDK Session Operations ──────────────────────────────────────────────

export async function tagSdkSession(sessionId: string, tag: string): Promise<boolean> {
  try {
    await tagSession(getSdkSessionId(sessionId), tag, getSessionMutationOptions(sessionId))
    return true
  } catch {
    return false
  }
}

export async function getSdkSessionInfo(sessionId: string): Promise<Record<string, unknown> | null> {
  try {
    const info = await getSessionInfo(getSdkSessionId(sessionId), getSessionMutationOptions(sessionId))
    return info as Record<string, unknown>
  } catch {
    return null
  }
}

export async function forkSdkSession(sessionId: string, options?: ForkSessionOptions): Promise<{ sessionId: string } | null> {
  try {
    const dir = getSessionDir(sessionId) || options?.dir
    const result = await sdkForkSession(getSdkSessionId(sessionId), {
      ...options,
      ...(dir ? { dir } : {}),
    } as ForkSessionOptions)
    return result as { sessionId: string } | null
  } catch {
    return null
  }
}

export async function loadSdkSessionMessagesTyped(sessionId: string): Promise<AgentIPCMessage[]> {
  try {
    const dir = getSessionDir(sessionId) || getAppSkillsCwd()
    const raw = await getSessionMessages(getSdkSessionId(sessionId), { dir })
    if (!Array.isArray(raw)) return []
    return raw.map(m => toAgentIPCMessage(m as any)).filter((m): m is AgentIPCMessage => m !== null)
  } catch {
    return []
  }
}
