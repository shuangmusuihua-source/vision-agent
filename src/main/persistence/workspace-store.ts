import { mkdirSync } from 'fs'
import path from 'path'
import type { WorkspaceRecord, SessionRecord } from '../../shared/types'
import { store, getKnowledgeBaseDir } from './store-core'

// ─── Authorized directories ────────────────────────────────────────────

export function getAuthorizedDirectories(): string[] {
  return store.get('authorizedDirectories')
}

export function addAuthorizedDirectory(dir: string): void {
  const dirs = store.get('authorizedDirectories')
  if (!dirs.includes(dir)) {
    store.set('authorizedDirectories', [dir, ...dirs])
  }
}

export function removeAuthorizedDirectory(dir: string): void {
  const fixed = store.get('fixedDirectories')
  if (fixed.includes(dir)) return
  const dirs = store.get('authorizedDirectories')
  store.set('authorizedDirectories', dirs.filter((d) => d !== dir))
}

export function reorderAuthorizedDirectories(paths: string[]): void {
  const fixed = store.get('fixedDirectories')
  const current = store.get('authorizedDirectories')
  if (paths.length !== current.length) return
  if (!paths.every((p) => current.includes(p))) return
  const fixedInPaths = fixed.filter(f => paths.includes(f))
  const nonFixed = paths.filter(p => !fixed.includes(p))
  store.set('authorizedDirectories', [...fixedInPaths, ...nonFixed])
}

export function getFixedDirectories(): string[] {
  return store.get('fixedDirectories')
}

// ─── Workspace records ──────────────────────────────────────────────────

export function getWorkspaces(): WorkspaceRecord[] {
  return store.get('workspaces')
}

export function setWorkspaces(workspaces: WorkspaceRecord[]): void {
  store.set('workspaces', workspaces)
}

export function getWorkspaceById(id: string): WorkspaceRecord | undefined {
  return store.get('workspaces').find(w => w.id === id)
}

export function getWorkspaceByPath(p: string): WorkspaceRecord | undefined {
  return store.get('workspaces').find(w => w.path === p)
}

export function addWorkspace(record: WorkspaceRecord): void {
  const workspaces = store.get('workspaces')
  if (!workspaces.some(w => w.id === record.id || w.path === record.path)) {
    store.set('workspaces', [...workspaces, record])
  }
}

export function removeWorkspace(id: string): void {
  const workspaces = store.get('workspaces').filter(w => w.id !== id)
  store.set('workspaces', workspaces)
}

// ─── Session records ──────────────────────────────────────────────────

export function getSessionRecords(): SessionRecord[] {
  return store.get('sessions')
}

export function getSessionsByWorkspace(workspacePath: string): SessionRecord[] {
  return store.get('sessions').filter(s => s.workspacePath === workspacePath)
}

export function getSessionRecordById(id: string): SessionRecord | undefined {
  return store.get('sessions').find(s => s.id === id)
}

export function addSessionRecord(record: SessionRecord): void {
  const sessions = store.get('sessions')
  const idx = sessions.findIndex(s => s.id === record.id)
  if (idx >= 0) {
    sessions[idx] = record
  } else {
    sessions.push(record)
  }
  store.set('sessions', sessions)
}

export function removeSessionRecord(id: string): void {
  const sessions = store.get('sessions').filter(s => s.id !== id)
  store.set('sessions', sessions)
  store.set('sessionArtifacts', store.get('sessionArtifacts').filter(a => a.sessionId !== id))
}

export function updateSessionRecord(id: string, patch: Partial<SessionRecord>): void {
  const sessions = store.get('sessions')
  const idx = sessions.findIndex(s => s.id === id)
  if (idx >= 0) {
    sessions[idx] = { ...sessions[idx], ...patch }
    store.set('sessions', sessions)
  }
}

// ─── Knowledge base ────────────────────────────────────────────────────

export function ensureKnowledgeBase(): string {
  const kbDir = getKnowledgeBaseDir()
  mkdirSync(kbDir, { recursive: true })
  mkdirSync(path.join(kbDir, '.vision'), { recursive: true })

  const fixed = store.get('fixedDirectories')
  if (!fixed.includes(kbDir)) {
    store.set('fixedDirectories', [kbDir, ...fixed])
  }

  const dirs = store.get('authorizedDirectories')
  if (!dirs.includes(kbDir)) {
    store.set('authorizedDirectories', [kbDir, ...dirs])
  } else if (dirs[0] !== kbDir) {
    store.set('authorizedDirectories', [kbDir, ...dirs.filter((d) => d !== kbDir)])
  }

  return kbDir
}

// ─── Store version ─────────────────────────────────────────────────────

export function getStoreVersion(): number {
  return store.get('storeVersion')
}

export function setStoreVersion(version: number): void {
  store.set('storeVersion', version)
}
