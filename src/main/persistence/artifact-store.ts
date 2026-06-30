import { createHash } from 'crypto'
import { existsSync } from 'fs'
import { stat } from 'fs/promises'
import { join } from 'path'
import type { SessionArtifactRecord, SessionOutputEntry } from '../../shared/types'
import {
  artifactCategoryFromFileType,
  artifactFileName,
  artifactFileTypeFromPath,
  extractArtifactPathsFromToolInput,
  isMemoryArtifactPath,
  normalizeArtifactPath,
} from '../artifact-utils'
import { store } from './store-core'
import { getAppUserDataDir } from '../app-identity'
import {
  createSessionArtifactSnapshot,
  removeSessionArtifactSnapshots,
} from '../artifact-snapshot'

const ARTIFACT_SNAPSHOT_ROOT = join(getAppUserDataDir(), 'session-artifacts')

type UpsertSessionArtifactInput = {
  sessionId: string
  sdkSessionId?: string
  workspacePath: string
  filePath: string
  source: string
  sourceTool?: string
  skillId?: string | null
  createdAt?: number
}

type RecordArtifactFromToolInput = {
  sessionId?: string
  sdkSessionId?: string
  workspacePath?: string
  toolName: string
  toolInput: unknown
  skillId?: string | null
  source?: string
}

function artifactId(sessionId: string, filePath: string): string {
  const hash = createHash('sha1').update(`${sessionId}\0${filePath}`).digest('hex')
  return `artifact-${hash.slice(0, 20)}`
}

function syncSessionArtifactCount(sessionId: string): void {
  const artifacts = store.get('sessionArtifacts')
  const count = artifacts.filter((artifact) => artifact.sessionId === sessionId).length
  const sessions = store.get('sessions')
  const idx = sessions.findIndex((session) => session.id === sessionId)
  if (idx < 0) return
  sessions[idx] = { ...sessions[idx], artifactCount: count }
  store.set('sessions', sessions)
}

export function getSessionArtifacts(sessionId: string): SessionArtifactRecord[] {
  return store
    .get('sessionArtifacts')
    .filter((artifact) => artifact.sessionId === sessionId)
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

export function toSessionOutputEntry(record: SessionArtifactRecord): SessionOutputEntry {
  return {
    fileName: record.fileName,
    filePath: record.filePath,
    fileType: record.fileType,
    category: record.category,
    availability: record.availability || (existsSync(record.filePath) ? 'available' : 'missing'),
    source: record.source,
    size: record.size,
    createdAt: record.createdAt,
  }
}

export async function getSessionArtifactOutputs(sessionId: string): Promise<SessionOutputEntry[]> {
  const legacyArtifacts = getSessionArtifacts(sessionId).filter((artifact) => !artifact.sourceFilePath)
  for (const artifact of legacyArtifacts) {
    if (!existsSync(artifact.filePath)) continue
    await upsertSessionArtifact({
      sessionId: artifact.sessionId,
      sdkSessionId: artifact.sdkSessionId,
      workspacePath: artifact.workspacePath,
      filePath: artifact.filePath,
      source: artifact.source,
      sourceTool: artifact.sourceTool,
      skillId: artifact.skillId,
      createdAt: artifact.createdAt,
    })
  }

  const artifacts = getSessionArtifacts(sessionId)
  let changed = false
  const records = store.get('sessionArtifacts')
  for (const artifact of artifacts) {
    const availability = existsSync(artifact.filePath) ? 'available' : 'missing'
    if (artifact.availability === availability) continue
    const idx = records.findIndex((record) => record.id === artifact.id)
    if (idx >= 0) {
      records[idx] = { ...records[idx], availability, updatedAt: Date.now() }
      changed = true
    }
  }
  if (changed) store.set('sessionArtifacts', records)
  return getSessionArtifacts(sessionId).map(toSessionOutputEntry)
}

export async function upsertSessionArtifact(input: UpsertSessionArtifactInput): Promise<SessionArtifactRecord | null> {
  const sessionId = input.sessionId
  const workspacePath = input.workspacePath || process.cwd()
  const sourceFilePath = normalizeArtifactPath(input.filePath, workspacePath)

  if (!sessionId || !sourceFilePath || isMemoryArtifactPath(sourceFilePath) || !existsSync(sourceFilePath)) {
    return null
  }

  let size: number | undefined
  try {
    const sourceStat = await stat(sourceFilePath)
    if (!sourceStat.isFile()) return null
    size = sourceStat.size
  } catch {
    return null
  }

  const now = Date.now()
  const records = store.get('sessionArtifacts')
  const idx = records.findIndex((record) => (
    record.sessionId === sessionId
    && (record.sourceFilePath === sourceFilePath || record.filePath === sourceFilePath)
  ))
  const existing = idx >= 0 ? records[idx] : null
  const originalSourcePath = existing?.sourceFilePath || sourceFilePath
  const id = existing?.id || artifactId(sessionId, originalSourcePath)
  const fileName = existing?.fileName || artifactFileName(originalSourcePath)
  let snapshotPath: string
  try {
    snapshotPath = await createSessionArtifactSnapshot({
      snapshotRoot: ARTIFACT_SNAPSHOT_ROOT,
      sessionId,
      artifactId: id,
      sourceFilePath,
      fileName,
    })
  } catch (error) {
    console.error('[ArtifactStore] failed to snapshot artifact:', error)
    return null
  }
  const fileType = artifactFileTypeFromPath(originalSourcePath)
  const next: SessionArtifactRecord = {
    id,
    sessionId,
    sdkSessionId: input.sdkSessionId || existing?.sdkSessionId,
    workspacePath,
    fileName,
    filePath: snapshotPath,
    sourceFilePath: originalSourcePath,
    fileType,
    category: artifactCategoryFromFileType(fileType),
    availability: 'available',
    source: input.source,
    sourceTool: input.sourceTool,
    skillId: input.skillId ?? existing?.skillId ?? null,
    size,
    createdAt: existing ? existing.createdAt : input.createdAt || now,
    updatedAt: now,
  }

  if (idx >= 0) {
    records[idx] = { ...records[idx], ...next }
  } else {
    records.push(next)
  }

  store.set('sessionArtifacts', records)
  syncSessionArtifactCount(sessionId)
  return next
}

export async function recordSessionArtifactsFromTool(
  input: RecordArtifactFromToolInput
): Promise<SessionArtifactRecord[]> {
  const filePaths = extractArtifactPathsFromToolInput(input.toolName, input.toolInput)
  if (!input.sessionId || filePaths.length === 0) return []
  const sessionId = input.sessionId

  const artifacts = await Promise.all(filePaths.map((filePath) => (
    upsertSessionArtifact({
      sessionId,
      sdkSessionId: input.sdkSessionId,
      workspacePath: input.workspacePath || process.cwd(),
      filePath,
      source: input.source || input.toolName,
      sourceTool: input.toolName,
      skillId: input.skillId,
    })
  )))
  return artifacts.filter((artifact): artifact is SessionArtifactRecord => artifact !== null)
}

export function removeSessionArtifacts(sessionId: string): void {
  const records = store.get('sessionArtifacts').filter((artifact) => artifact.sessionId !== sessionId)
  store.set('sessionArtifacts', records)
  syncSessionArtifactCount(sessionId)
  void removeSessionArtifactSnapshots(ARTIFACT_SNAPSHOT_ROOT, sessionId).catch((error) => {
    console.error('[ArtifactStore] failed to remove snapshots:', error)
  })
}
