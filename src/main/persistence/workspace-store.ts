import { mkdirSync } from 'fs'
import path from 'path'
import type { WorkspaceRecord, SessionRecord } from '../../shared/types'
import { store, getKnowledgeBaseDir } from './store-core'
import { filterUserWorkspacePaths, isReservedKnowledgeWorkspacePath } from '../../shared/workspace-paths'

function isSessionContext(value: unknown): value is SessionRecord['context'] {
  return value === 'editor' || value === 'ask'
}

function isSessionStatus(value: unknown): value is SessionRecord['status'] {
  return value === 'active' || value === 'idle' || value === 'archived' || value === 'empty'
}

function numberOrDefault(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

// ─── Authorized directories ────────────────────────────────────────────

export function getAuthorizedDirectories(): string[] {
  return filterUserWorkspacePaths(store.get('authorizedDirectories'), store.get('fixedDirectories'))
}

export function addAuthorizedDirectory(dir: string): void {
  if (isReservedKnowledgeWorkspacePath(dir, store.get('fixedDirectories'))) return
  const dirs = getAuthorizedDirectories()
  if (!dirs.includes(dir)) {
    store.set('authorizedDirectories', [dir, ...dirs])
  }
}

export function removeAuthorizedDirectory(dir: string): void {
  const fixed = store.get('fixedDirectories')
  const dirs = store.get('authorizedDirectories')
  if (fixed.includes(dir) || isReservedKnowledgeWorkspacePath(dir, fixed)) {
    store.set('authorizedDirectories', dirs.filter((d) => d !== dir))
    return
  }
  store.set('authorizedDirectories', dirs.filter((d) => d !== dir))
}

export function reorderAuthorizedDirectories(paths: string[]): void {
  const fixed = store.get('fixedDirectories')
  const current = getAuthorizedDirectories()
  const nextPaths = filterUserWorkspacePaths(paths, fixed)
  if (nextPaths.length !== current.length) return
  if (!nextPaths.every((p) => current.includes(p))) return
  store.set('authorizedDirectories', nextPaths)
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
}

export function updateSessionRecord(id: string, patch: Partial<SessionRecord>): void {
  const sessions = store.get('sessions')
  const idx = sessions.findIndex(s => s.id === id)
  if (idx >= 0) {
    sessions[idx] = { ...sessions[idx], ...patch }
    store.set('sessions', sessions)
    return
  }

  if (typeof patch.workspacePath !== 'string' || !isSessionContext(patch.context)) {
    return
  }

  const now = Date.now()
  const record: SessionRecord = {
    id,
    workspacePath: patch.workspacePath,
    context: patch.context,
    status: isSessionStatus(patch.status) ? patch.status : 'empty',
    createdAt: numberOrDefault(patch.createdAt, now),
    lastModified: numberOrDefault(patch.lastModified, now),
    messageCount: numberOrDefault(patch.messageCount, 0),
  }

  if (typeof patch.sdkSessionId === 'string') record.sdkSessionId = patch.sdkSessionId
  if (typeof patch.workingDirectory === 'string') record.workingDirectory = patch.workingDirectory
  if (typeof patch.title === 'string') record.title = patch.title
  if (typeof patch.summary === 'string') record.summary = patch.summary
  if (typeof patch.firstPrompt === 'string') record.firstPrompt = patch.firstPrompt
  if (Array.isArray(patch.tags)) record.tags = patch.tags.filter((tag): tag is string => typeof tag === 'string')
  store.set('sessions', [...sessions, record])
}

// ─── Knowledge base ────────────────────────────────────────────────────

export function ensureKnowledgeBase(): string {
  const kbDir = getKnowledgeBaseDir()
  mkdirSync(kbDir, { recursive: true })
  mkdirSync(path.join(kbDir, '.vision'), { recursive: true })

  const fixed = store.get('fixedDirectories')
  const nextFixed = [kbDir, ...fixed.filter((dir) => !isReservedKnowledgeWorkspacePath(dir, [kbDir]))]
  if (nextFixed.length !== fixed.length || nextFixed.some((dir, index) => dir !== fixed[index])) {
    store.set('fixedDirectories', nextFixed)
  }

  const dirs = store.get('authorizedDirectories')
  const userDirs = filterUserWorkspacePaths(dirs, nextFixed)
  if (userDirs.length !== dirs.length || userDirs.some((dir, index) => dir !== dirs[index])) {
    store.set('authorizedDirectories', userDirs)
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
