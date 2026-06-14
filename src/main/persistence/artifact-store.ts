import { createHash } from 'crypto'
import { existsSync, statSync } from 'fs'
import type { SessionArtifactRecord, SessionOutputEntry } from '../../shared/types'
import {
  artifactCategoryFromFileType,
  artifactFileName,
  artifactFileTypeFromPath,
  extractArtifactPathFromToolInput,
  isMemoryArtifactPath,
  normalizeArtifactPath,
} from '../artifact-utils'
import { store } from './store-core'

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
    source: record.source,
    size: record.size,
    createdAt: record.createdAt,
  }
}

export function getSessionArtifactOutputs(sessionId: string): SessionOutputEntry[] {
  const artifacts = getSessionArtifacts(sessionId)
  const existing = artifacts.filter((artifact) => existsSync(artifact.filePath))
  if (existing.length !== artifacts.length) {
    const existingIds = new Set(existing.map((artifact) => artifact.id))
    const records = store
      .get('sessionArtifacts')
      .filter((artifact) => artifact.sessionId !== sessionId || existingIds.has(artifact.id))
    store.set('sessionArtifacts', records)
    syncSessionArtifactCount(sessionId)
  }
  return existing.map(toSessionOutputEntry)
}

export function upsertSessionArtifact(input: UpsertSessionArtifactInput): SessionArtifactRecord | null {
  const sessionId = input.sessionId
  const workspacePath = input.workspacePath || process.cwd()
  const filePath = normalizeArtifactPath(input.filePath, workspacePath)

  if (!sessionId || !filePath || isMemoryArtifactPath(filePath) || !existsSync(filePath)) {
    return null
  }

  let size: number | undefined
  try {
    const stat = statSync(filePath)
    if (!stat.isFile()) return null
    size = stat.size
  } catch {
    return null
  }

  const now = Date.now()
  const records = store.get('sessionArtifacts')
  const id = artifactId(sessionId, filePath)
  const idx = records.findIndex((record) => record.sessionId === sessionId && record.filePath === filePath)
  const existing = idx >= 0 ? records[idx] : null
  const fileType = artifactFileTypeFromPath(filePath)
  const next: SessionArtifactRecord = {
    id,
    sessionId,
    sdkSessionId: input.sdkSessionId || existing?.sdkSessionId,
    workspacePath,
    fileName: artifactFileName(filePath),
    filePath,
    fileType,
    category: artifactCategoryFromFileType(fileType),
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

export function recordSessionArtifactFromTool(
  input: RecordArtifactFromToolInput
): SessionArtifactRecord | null {
  const filePath = extractArtifactPathFromToolInput(input.toolName, input.toolInput)
  if (!input.sessionId || !filePath) return null

  return upsertSessionArtifact({
    sessionId: input.sessionId,
    sdkSessionId: input.sdkSessionId,
    workspacePath: input.workspacePath || process.cwd(),
    filePath,
    source: input.source || input.toolName,
    sourceTool: input.toolName,
    skillId: input.skillId,
  })
}

export function removeSessionArtifacts(sessionId: string): void {
  const records = store.get('sessionArtifacts').filter((artifact) => artifact.sessionId !== sessionId)
  store.set('sessionArtifacts', records)
  syncSessionArtifactCount(sessionId)
}
