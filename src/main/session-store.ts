import { listSessions, getSessionMessages, renameSession, deleteSession } from '@anthropic-ai/claude-agent-sdk'
import type { SessionMutationOptions } from '@anthropic-ai/claude-agent-sdk'
import { toAgentIPCMessage } from './message-converter'
import type { AgentIPCMessage, SdkSessionInfo } from '../shared/types'
import { getSessionRecords, removeSessionRecord, updateSessionRecord, getCompactionSessionIds, addCompactionSessionId, deleteCompactionSessionId } from './store'
import { resolveClaudeSessionJsonlPath } from './claude-session-path'
import { readJsonlTailPage } from './jsonl-tail-reader'
import { removeSessionWorkingDirectory } from './session-files'

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
  if (record?.workingDirectory) return record.workingDirectory
  return undefined
}

function getSessionMutationOptions(sessionId: string): SessionMutationOptions | undefined {
  const dir = getSessionDir(sessionId)
  return dir ? { dir } : undefined
}

function isSessionNotFoundError(err: unknown): boolean {
  return err instanceof Error && /not found/i.test(err.message)
}

async function withSessionDir<T>(
  sessionId: string,
  operation: (sdkSessionId: string, options?: SessionMutationOptions) => Promise<T>
): Promise<T> {
  const sdkSessionId = getSdkSessionId(sessionId)
  const options = getSessionMutationOptions(sessionId)
  if (!options) throw new Error(`Session working directory not found: ${sessionId}`)
  return await operation(sdkSessionId, options)
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
    const sessionCreatedAtMap = new Map<string, number>()
    for (const r of records) {
      const sdkId = r.sdkSessionId || r.id
      if (r.workspacePath) sessionWorkspaceMap.set(sdkId, r.workspacePath)
      sessionContextMap.set(sdkId, r.context)
      sessionAppIdMap.set(sdkId, r.id)
      sessionCreatedAtMap.set(sdkId, r.createdAt)
      if (r.title) sessionTitleMap.set(sdkId, r.title)
    }

    const results: SdkSessionInfo[] = []
    const seenIds = new Set<string>()
    const sessionDirs = new Set<string>()
    for (const record of records) {
      if (workspaceCwd && record.workspacePath !== workspaceCwd) continue
      if (record.workingDirectory) sessionDirs.add(record.workingDirectory)
    }

    for (const dir of sessionDirs) {
      try {
        const dirResult = await listSessions({ dir })
        for (const s of dirResult) {
          if (!seenIds.has(s.sessionId)) {
            seenIds.add(s.sessionId)
            if (compactionSessionIds.has(s.sessionId)) continue
            const appId = sessionAppIdMap.get(s.sessionId)
            if (!appId) continue
            results.push({
              id: appId,
              sdkSessionId: s.sessionId,
              title: sessionTitleMap.get(s.sessionId) || s.customTitle || s.summary || s.firstPrompt,
              createdAt: sessionCreatedAtMap.get(s.sessionId) ?? s.createdAt,
              lastModified: s.lastModified,
              messageCount: (s as Record<string, unknown>).messageCount as number || 0,
              cwd: dir,
              workspacePath: sessionWorkspaceMap.get(s.sessionId),
              context: sessionContextMap.get(s.sessionId),
            })
          }
        }
      } catch (err) {
        console.error('[SessionStore] listSessions directory error:', dir, err)
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
          cwd: r.workingDirectory,
          workspacePath: r.workspacePath,
          context: r.context,
        })
      }
    }

    // Return both entry types. The renderer separates Ask sumi sessions
    // from workspace sessions by context so the two entry points stay isolated.
    return results.sort((a, b) => (
      (b.createdAt || 0) - (a.createdAt || 0)
      || (b.lastModified || 0) - (a.lastModified || 0)
      || a.id.localeCompare(b.id)
    ))
  } catch (err) {
    console.error('[SessionStore] listSessions error:', err)
    return []
  }
}

export async function getSdkSessionTotalMessageCount(
  sessionId: string,
  _workspaceCwd?: string
): Promise<number> {
  try {
    const sdkSessionId = getSdkSessionId(sessionId)
    const sessionDir = getSessionDir(sessionId)
    if (!sessionDir) return 0
    const dirs = [sessionDir]
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
function getSessionJsonlPath(sessionId: string): string | null {
  return resolveClaudeSessionJsonlPath(getSdkSessionId(sessionId), getSessionDir(sessionId))
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
  const jsonlPath = getSessionJsonlPath(sessionId)
  if (jsonlPath) {
    try {
      const page = await readJsonlTailPage(jsonlPath, limit, offset)
      const messages: AgentIPCMessage[] = []
      for (const m of page.records) {
        const converted = toAgentIPCMessage(m as any)
        if (converted) messages.push(converted)
      }
      return { messages, offset: page.offset, limit, hasMore: page.hasMore }
    } catch (err) {
      console.warn('[SessionStore] Tail JSONL read failed, falling back to SDK:', (err as Error).message)
    }
  }

  // Fallback to SDK API — used only when direct JSONL read fails
  // (no workspacePath in session record). SDK API uses forward pagination
  // (oldest→newest, offset increases); the direct path uses backward
  // (newest→oldest, offset decreases).  This fallback does NOT match the
  // direct path's "newest first" behavior for initial load — it returns
  // the oldest messages instead.  Acceptable because this path is rarely hit.
  const dir = getSessionDir(sessionId)
  if (!dir) return { messages: [], offset, limit, hasMore: false }
  const sdkMessages = await getSessionMessages(getSdkSessionId(sessionId), {
    limit,
    offset,
    includeSystemMessages: true,
    dir,
  })
  const messages: AgentIPCMessage[] = []
  for (const m of sdkMessages) {
    const converted = toAgentIPCMessage(m as any)
    if (converted) messages.push(converted)
  }
  return { messages, offset: offset + sdkMessages.length, limit, hasMore: sdkMessages.length >= limit }
}

export async function renameSdkSession(sessionId: string, title: string): Promise<void> {
  const record = getRecordForSession(sessionId)
  const appSessionId = getAppSessionId(sessionId)
  updateSessionRecord(appSessionId, { title, lastModified: Date.now() })

  // Empty app-owned sessions have no SDK history yet. The app record is the
  // authoritative title and is sufficient until the first message materializes.
  if (record && !record.sdkSessionId) return

  try {
    await withSessionDir(sessionId, (sdkSessionId, options) => renameSession(sdkSessionId, title, options))
  } catch (err) {
    // SDK metadata is a secondary mirror. Keep the app-owned title durable
    // even if SDK history has already been compacted or removed.
    console.warn('[SessionStore] SDK title mirror skipped:', {
      sessionId: appSessionId,
      sdkSessionId: getSdkSessionId(sessionId),
      missing: isSessionNotFoundError(err),
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

/**
 * Delete a session from SDK storage and clean up tracking metadata.
 * Callers MUST abort any running query for this session BEFORE calling this
 * function — query-runner.abortActiveQuery(sessionId) should be called first.</summary>
*/
export async function deleteSdkSession(sessionId: string): Promise<void> {
  const sdkSessionId = getSdkSessionId(sessionId)
  const appSessionId = getAppSessionId(sessionId)
  const record = getRecordForSession(sessionId)

  try {
    const options = getSessionMutationOptions(sessionId)
    if (options && record?.sdkSessionId) {
      await deleteSession(sdkSessionId, options)
    }
  } catch (err) {
    console.warn('[SessionStore] SDK history cleanup skipped:', {
      sessionId: appSessionId,
      sdkSessionId,
      error: err instanceof Error ? err.message : String(err),
    })
  }

  if (record) {
    await removeSessionWorkingDirectory(
      record.workspacePath,
      record.workingDirectory,
      record.context,
    )
  }

  compactionSessionIds.delete(sdkSessionId)
  deleteCompactionSessionId(sdkSessionId)
  removeSessionRecord(appSessionId)
}
