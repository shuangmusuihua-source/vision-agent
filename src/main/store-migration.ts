import { deleteSession } from '@anthropic-ai/claude-agent-sdk'
import { rm } from 'fs/promises'
import { join } from 'path'
import { generateUUID } from './uuid'
import { getAppUserDataDir } from './app-identity'
import { getAppSkillsCwd } from './skill-init'
import { store } from './persistence/store-core'
import type { WorkspaceRecord } from '../shared/types'

let migrationStarted = false
const CURRENT_STORE_VERSION = 4

function uniquePaths(paths: Array<string | undefined>): string[] {
  return [...new Set(paths.filter((path): path is string => Boolean(path)))]
}

async function removeTrackedSdkSessionHistory(
  sessionsByDirectory: Map<string, Set<string>>,
): Promise<void> {
  for (const [dir, sessionIds] of sessionsByDirectory) {
    const results = await Promise.allSettled(
      [...sessionIds].map((sessionId) => deleteSession(sessionId, { dir })),
    )
    const failed = results.filter((result) => result.status === 'rejected').length
    if (failed > 0) {
      console.warn(`[Migration] failed to delete ${failed} tracked SDK sessions in ${dir}`)
    }
  }
}

function buildWorkspaceRecords(fixed: string[], authorized: string[]): WorkspaceRecord[] {
  const seenPaths = new Set<string>()
  const workspaces: WorkspaceRecord[] = []
  const dirs = [...fixed, ...authorized.filter((dir) => !fixed.includes(dir))]

  for (const dir of dirs) {
    if (seenPaths.has(dir)) continue
    seenPaths.add(dir)
    workspaces.push({
      id: generateUUID(),
      name: dir.split('/').pop() || dir,
      path: dir,
      icon: fixed.includes(dir) ? '📚' : '📁',
      isFixed: fixed.includes(dir),
      createdAt: Date.now(),
      lastOpenedAt: Date.now(),
    })
  }

  return workspaces
}

/**
 * Migrate persisted data to the session-files model.
 *
 * v0/v1 → v2 removes pre-isolation session history and introduces dedicated
 * session directories. v2 → v3 keeps those sessions and removes the obsolete
 * event-driven artifact registry; the session directory is now authoritative.
 */
export async function migrateStore(): Promise<void> {
  if (migrationStarted) return
  migrationStarted = true

  const currentVersion = store.get('storeVersion')
  if (currentVersion >= CURRENT_STORE_VERSION) {
    console.log(`[Migration] already at v${CURRENT_STORE_VERSION}, skipping`)
    return
  }

  console.log(`[Migration] starting v${currentVersion} → v${CURRENT_STORE_VERSION} migration`)

  try {
    const fixed = store.get('fixedDirectories')
    const authorized = store.get('authorizedDirectories')
    let workspaces = store.get('workspaces')
    if (workspaces.length === 0) {
      workspaces = buildWorkspaceRecords(fixed, authorized)
      store.set('workspaces', workspaces)
      console.log(`[Migration] created ${workspaces.length} WorkspaceRecords`)
    }

    if (currentVersion < 2) {
      const sessionRecords = store.get('sessions')
      const workspacePaths = uniquePaths([
        ...fixed,
        ...authorized,
        ...workspaces.map((workspace) => workspace.path),
        ...sessionRecords.map((session) => session.workspacePath),
      ])
      const appSkillsCwd = getAppSkillsCwd()
      const sessionsByDirectory = new Map<string, Set<string>>()
      for (const session of sessionRecords) {
        const dir = session.workingDirectory
          || (session.context === 'ask' ? appSkillsCwd : session.workspacePath)
        const ids = sessionsByDirectory.get(dir) || new Set<string>()
        ids.add(session.sdkSessionId || session.id)
        sessionsByDirectory.set(dir, ids)
      }
      const compactionIds = store.get('compactionSessionIds')
      if (compactionIds.length > 0) {
        for (const ids of sessionsByDirectory.values()) {
          compactionIds.forEach((id) => ids.add(id))
        }
      }

      await removeTrackedSdkSessionHistory(sessionsByDirectory)
      await Promise.all(workspacePaths.map(async (workspacePath) => {
        await rm(join(workspacePath, '.sumi', 'sessions'), { recursive: true, force: true }).catch((error) => {
          console.warn('[Migration] failed to remove managed session files:', workspacePath, error)
        })
      }))
      await rm(join(getAppUserDataDir(), 'session-artifacts'), { recursive: true, force: true }).catch((error) => {
        console.warn('[Migration] failed to remove legacy artifact snapshots:', error)
      })

      store.set('sessions', [])
      store.set('compactionSessionIds', [])
    }

    // Legacy electron-store keys are removed without affecting v2 sessions.
    store.delete('sessionArtifacts' as never)

    if (currentVersion < 4) {
      const askSessions = store.get('sessions').filter((session) => session.context === 'ask')
      const askSessionsByDirectory = new Map<string, Set<string>>()
      for (const session of askSessions) {
        const dir = session.workingDirectory || getAppSkillsCwd()
        const ids = askSessionsByDirectory.get(dir) || new Set<string>()
        ids.add(session.sdkSessionId || session.id)
        askSessionsByDirectory.set(dir, ids)
      }
      await removeTrackedSdkSessionHistory(askSessionsByDirectory)
      await rm(join(getAppUserDataDir(), '.sumi', 'ask-sessions'), {
        recursive: true,
        force: true,
      }).catch((error) => {
        console.warn('[Migration] failed to remove legacy Ask session files:', error)
      })
      store.set('sessions', store.get('sessions').filter((session) => session.context !== 'ask'))
    }

    store.set('storeVersion', CURRENT_STORE_VERSION)
    console.log(`[Migration] v${currentVersion} → v${CURRENT_STORE_VERSION} complete`)
  } catch (err) {
    console.error('[Migration] migration failed:', err)
    migrationStarted = false
    throw err
  }
}
