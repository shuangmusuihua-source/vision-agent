import { generateUUID } from './uuid'
import {
  getStoreVersion, setStoreVersion,
  getWorkspaces, setWorkspaces,
  getSessionRecords, addSessionRecord,
  getFixedDirectories, getAuthorizedDirectories,
} from './store'
import type { WorkspaceRecord, SessionRecord } from '../shared/types'
import { listSdkSessions } from './agent-manager'

let migrationStarted = false

/**
 * Migrate from storeVersion 0 → 1.
 *
 * v0 → v1:
 *  1. Convert authorizedDirectories → WorkspaceRecord[] (UUID per directory)
 *  2. Query SDK for legacy sessions → SessionRecord[] (assign to first workspace)
 *  3. Set storeVersion = 1
 *
 * Best-effort: if SDK query fails, sessions array stays empty.
 * Non-blocking: caller should fire-and-forget with .catch().
 */
export async function migrateToV1(): Promise<void> {
  if (migrationStarted) return
  migrationStarted = true

  const currentVersion = getStoreVersion()
  if (currentVersion >= 1) {
    console.log('[Migration] already at v1, skipping')
    return
  }

  console.log('[Migration] starting v0 → v1 migration')

  try {
    const authorized = getAuthorizedDirectories()
    const fixed = getFixedDirectories()

    // Step 1: Convert directories to WorkspaceRecord[]
    const seenPaths = new Set<string>()
    const workspaces: WorkspaceRecord[] = []

    const dirs = [...fixed, ...authorized.filter(d => !fixed.includes(d))]
    for (const dir of dirs) {
      if (seenPaths.has(dir)) continue
      seenPaths.add(dir)

      const name = dir.split('/').pop() || dir
      workspaces.push({
        id: generateUUID(),
        name,
        path: dir,
        icon: fixed.includes(dir) ? '📚' : '📁',
        isFixed: fixed.includes(dir),
        createdAt: Date.now(),
        lastOpenedAt: Date.now(),
      })
    }

    setWorkspaces(workspaces)
    console.log(`[Migration] created ${workspaces.length} WorkspaceRecords`)

    // Step 2: Query SDK for legacy sessions
    let legacySessions: SessionRecord[] = []
    try {
      const sdkSessions = await listSdkSessions()
      const firstWorkspace = workspaces[0]

      if (firstWorkspace && sdkSessions.length > 0) {
        legacySessions = sdkSessions.map(s => ({
          id: s.id,
          workspacePath: firstWorkspace.path,
          title: s.title,
          firstPrompt: s.title,
          context: 'editor',
          status: 'idle' as const,
          createdAt: s.createdAt || Date.now(),
          lastModified: s.lastModified || Date.now(),
          messageCount: s.messageCount || 0,
          artifactCount: 0,
          legacyMigration: true,
        }))

        for (const record of legacySessions) {
          addSessionRecord(record)
        }
        console.log(`[Migration] migrated ${legacySessions.length} legacy sessions`)
      }
    } catch (err) {
      console.warn('[Migration] SDK session query failed (best-effort, continuing):', err)
    }

    // Step 3: Set version
    setStoreVersion(1)
    console.log('[Migration] v0 → v1 complete')
  } catch (err) {
    console.error('[Migration] migration failed:', err)
    migrationStarted = false
  }
}
