import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { generateUUID } from './uuid'
import type { ArtifactFileType } from '../shared/types'

// ─── Types ────────────────────────────────────────────────────────────────

export interface DeliverableFile {
  fileName: string
  filePath: string
  fileType: ArtifactFileType
  size?: number
}

export interface DeliverableEntry {
  id: string
  sessionId: string
  workspacePath: string
  sourceMdPath: string
  skillId: string
  skillName: string
  files: DeliverableFile[]
  outputDir: string
  prompt: string
  createdAt: number
  updatedAt: number
  sourceMissing?: boolean
}

export interface DeliverableIndex {
  version: 1
  workspacePath: string
  updatedAt: number
  deliverables: DeliverableEntry[]
}

// ─── Atomic write helpers ─────────────────────────────────────────────────

const writeLocks = new Map<string, Promise<void>>()

function withLock(workspacePath: string, fn: () => Promise<void>): Promise<void> {
  const prev = writeLocks.get(workspacePath) ?? Promise.resolve()
  const next = prev.then(fn).finally(() => {
    if (writeLocks.get(workspacePath) === next) writeLocks.delete(workspacePath)
  })
  writeLocks.set(workspacePath, next)
  return next
}

function getIndexPath(workspacePath: string): string {
  return join(workspacePath, '.vision', 'deliverables.json')
}

function ensureVisionDir(workspacePath: string): void {
  mkdirSync(join(workspacePath, '.vision'), { recursive: true })
}

function readIndex(workspacePath: string): DeliverableIndex {
  const filePath = getIndexPath(workspacePath)
  try {
    if (!existsSync(filePath)) {
      return { version: 1, workspacePath, updatedAt: Date.now(), deliverables: [] }
    }
    const raw = readFileSync(filePath, 'utf-8')
    const data = JSON.parse(raw) as DeliverableIndex
    if (data.version !== 1 || !Array.isArray(data.deliverables)) {
      throw new Error('Invalid deliverable index format')
    }
    return data
  } catch (err) {
    console.warn(`[DeliverableService] corrupted index for ${workspacePath}`, err)
    try {
      const bakPath = filePath + `.bak.${Date.now()}`
      if (existsSync(filePath)) renameSync(filePath, bakPath)
    } catch { /* best-effort */ }
    return { version: 1, workspacePath, updatedAt: Date.now(), deliverables: [] }
  }
}

async function writeIndex(workspacePath: string, data: DeliverableIndex): Promise<void> {
  ensureVisionDir(workspacePath)
  const filePath = getIndexPath(workspacePath)
  const tmpPath = filePath + '.tmp'
  const json = JSON.stringify(data, null, 2)
  writeFileSync(tmpPath, json, 'utf-8')
  renameSync(tmpPath, filePath)
}

// ─── Public API ───────────────────────────────────────────────────────────

export async function registerDeliverable(
  entry: Omit<DeliverableEntry, 'id' | 'createdAt' | 'updatedAt'>
): Promise<DeliverableEntry> {
  const record: DeliverableEntry = {
    ...entry,
    id: generateUUID(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }

  await withLock(entry.workspacePath, async () => {
    const index = readIndex(entry.workspacePath)
    index.deliverables.unshift(record)
    index.updatedAt = Date.now()
    await writeIndex(entry.workspacePath, index)
  })

  return record
}

export async function listDeliverables(workspacePath: string): Promise<DeliverableEntry[]> {
  return readIndex(workspacePath).deliverables
}

export async function getDeliverable(
  workspacePath: string,
  id: string
): Promise<DeliverableEntry | null> {
  const index = readIndex(workspacePath)
  return index.deliverables.find(d => d.id === id) ?? null
}

export async function deleteDeliverable(
  workspacePath: string,
  id: string
): Promise<void> {
  await withLock(workspacePath, async () => {
    const index = readIndex(workspacePath)
    index.deliverables = index.deliverables.filter(d => d.id !== id)
    index.updatedAt = Date.now()
    await writeIndex(workspacePath, index)
  })
}

export async function markSourceMissing(
  workspacePath: string,
  sourceMdPath: string
): Promise<void> {
  await withLock(workspacePath, async () => {
    const index = readIndex(workspacePath)
    let changed = false
    for (const d of index.deliverables) {
      if (d.sourceMdPath === sourceMdPath && !d.sourceMissing) {
        d.sourceMissing = true
        d.updatedAt = Date.now()
        changed = true
      }
    }
    if (changed) {
      index.updatedAt = Date.now()
      await writeIndex(workspacePath, index)
    }
  })
}

export async function clearSourceMissing(
  workspacePath: string,
  sourceMdPath: string
): Promise<void> {
  await withLock(workspacePath, async () => {
    const index = readIndex(workspacePath)
    let changed = false
    for (const d of index.deliverables) {
      if (d.sourceMdPath === sourceMdPath && d.sourceMissing) {
        d.sourceMissing = false
        d.updatedAt = Date.now()
        changed = true
      }
    }
    if (changed) {
      index.updatedAt = Date.now()
      await writeIndex(workspacePath, index)
    }
  })
}
