import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync, unlinkSync } from 'fs'
import { join, dirname } from 'path'
import { generateUUID } from './uuid'
import type { ArtifactRecord, ArtifactIndexFile, ArtifactFileType, ArtifactCategory } from '../shared/types'

// ─── Per-workspace mutex to serialize writes ──────────────────────────────

const writeLocks = new Map<string, Promise<void>>()

function withLock(workspacePath: string, fn: () => Promise<void>): Promise<void> {
  const prev = writeLocks.get(workspacePath) ?? Promise.resolve()
  const next = prev.then(fn).finally(() => {
    if (writeLocks.get(workspacePath) === next) writeLocks.delete(workspacePath)
  })
  writeLocks.set(workspacePath, next)
  return next
}

// ─── Path helpers ──────────────────────────────────────────────────────────

function getIndexPath(workspacePath: string): string {
  return join(workspacePath, '.vision', 'artifacts.json')
}

function ensureVisionDir(workspacePath: string): void {
  mkdirSync(join(workspacePath, '.vision'), { recursive: true })
}

// ─── Read/Write ────────────────────────────────────────────────────────────

function readIndex(workspacePath: string): ArtifactIndexFile {
  const filePath = getIndexPath(workspacePath)
  try {
    if (!existsSync(filePath)) {
      return { version: 1, workspacePath, updatedAt: Date.now(), artifacts: [] }
    }
    const raw = readFileSync(filePath, 'utf-8')
    const data = JSON.parse(raw) as ArtifactIndexFile
    if (data.version !== 1 || !Array.isArray(data.artifacts)) {
      throw new Error('Invalid artifact index format')
    }
    return data
  } catch (err) {
    // Corrupted file: backup and start fresh
    console.warn(`[ArtifactService] corrupted index for ${workspacePath}, creating backup`, err)
    try {
      const bakPath = filePath + `.bak.${Date.now()}`
      if (existsSync(filePath)) renameSync(filePath, bakPath)
    } catch { /* best-effort */ }
    return { version: 1, workspacePath, updatedAt: Date.now(), artifacts: [] }
  }
}

async function writeIndex(
  workspacePath: string,
  data: ArtifactIndexFile
): Promise<void> {
  ensureVisionDir(workspacePath)
  const filePath = getIndexPath(workspacePath)
  const tmpPath = filePath + '.tmp'
  const json = JSON.stringify(data, null, 2)
  writeFileSync(tmpPath, json, 'utf-8')
  renameSync(tmpPath, filePath) // atomic on POSIX
}

// ─── Public API ────────────────────────────────────────────────────────────

const MAX_ARTIFACTS = 500

export async function addArtifact(
  workspacePath: string,
  artifact: Omit<ArtifactRecord, 'id' | 'createdAt' | 'updatedAt'>
): Promise<ArtifactRecord> {
  const record: ArtifactRecord = {
    ...artifact,
    id: generateUUID(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }

  await withLock(workspacePath, async () => {
    const index = readIndex(workspacePath)
    index.artifacts.unshift(record)
    if (index.artifacts.length > MAX_ARTIFACTS) {
      index.artifacts = index.artifacts.slice(0, MAX_ARTIFACTS)
    }
    index.updatedAt = Date.now()
    await writeIndex(workspacePath, index)
  })

  return record
}

export async function listByWorkspace(workspacePath: string): Promise<ArtifactRecord[]> {
  const index = readIndex(workspacePath)
  return index.artifacts
}

export async function listBySession(
  workspacePath: string,
  sessionId: string
): Promise<ArtifactRecord[]> {
  const index = readIndex(workspacePath)
  return index.artifacts.filter(a => a.sessionId === sessionId)
}

export async function getArtifact(
  workspacePath: string,
  artifactId: string
): Promise<ArtifactRecord | null> {
  const index = readIndex(workspacePath)
  return index.artifacts.find(a => a.id === artifactId) ?? null
}

export async function removeArtifact(
  workspacePath: string,
  artifactId: string
): Promise<void> {
  await withLock(workspacePath, async () => {
    const index = readIndex(workspacePath)
    index.artifacts = index.artifacts.filter(a => a.id !== artifactId)
    index.updatedAt = Date.now()
    await writeIndex(workspacePath, index)
  })
}

export {
  readIndex,
}
