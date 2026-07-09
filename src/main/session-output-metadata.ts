import { mkdir, readFile, readdir, stat } from 'fs/promises'
import { basename, join, relative, resolve, sep } from 'path'
import { atomicWriteTextFile } from './atomic-write'
import { artifactCategoryFromFileType, artifactFileTypeFromPath } from './artifact-utils'

const METADATA_FILE_NAME = '.sumi-output-metadata.json'

export interface SessionOutputMetadataEntry {
  createdAt: number
  skillId?: string
  sourceDocumentPath?: string
}

export interface SessionOutputMetadataFile {
  version: 1
  files: Record<string, SessionOutputMetadataEntry>
}

export type SessionOutputSnapshot = Record<string, { size: number; modifiedAt: number; createdAt: number }>

function isSafeRelativePath(value: string): boolean {
  return Boolean(value)
    && value !== '..'
    && !value.startsWith(`..${sep}`)
    && !value.split(sep).some((part) => part.startsWith('.'))
}

async function collectSnapshot(root: string, directory: string, snapshot: SessionOutputSnapshot): Promise<void> {
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue
    const filePath = join(directory, entry.name)
    if (entry.isDirectory()) {
      await collectSnapshot(root, filePath, snapshot)
      continue
    }
    if (!entry.isFile()) continue
    try {
      const fileStat = await stat(filePath)
      const relativePath = relative(root, filePath)
      if (!isSafeRelativePath(relativePath)) continue
      snapshot[relativePath] = {
        size: fileStat.size,
        modifiedAt: fileStat.mtimeMs,
        createdAt: fileStat.birthtimeMs || fileStat.ctimeMs || fileStat.mtimeMs,
      }
    } catch {
      // Files may be atomically replaced while the SDK is writing them.
    }
  }
}

export async function captureSessionOutputSnapshot(workingDirectory: string): Promise<SessionOutputSnapshot> {
  const snapshot: SessionOutputSnapshot = {}
  await collectSnapshot(resolve(workingDirectory), resolve(workingDirectory), snapshot)
  return snapshot
}

export async function readSessionOutputMetadata(workingDirectory: string): Promise<SessionOutputMetadataFile> {
  try {
    const parsed = JSON.parse(await readFile(join(workingDirectory, METADATA_FILE_NAME), 'utf8')) as SessionOutputMetadataFile
    if (parsed.version === 1 && parsed.files && typeof parsed.files === 'object') return parsed
  } catch {
    // First use or malformed legacy metadata: rebuild from the file system.
  }
  return { version: 1, files: {} }
}

export async function writeSessionOutputMetadata(
  workingDirectory: string,
  metadata: SessionOutputMetadataFile,
): Promise<void> {
  await mkdir(workingDirectory, { recursive: true })
  await atomicWriteTextFile(
    join(workingDirectory, METADATA_FILE_NAME),
    `${JSON.stringify(metadata, null, 2)}\n`,
  )
}

export async function reconcileSessionOutputMetadata(
  workingDirectory: string,
  snapshot: SessionOutputSnapshot,
): Promise<SessionOutputMetadataFile> {
  const metadata = await readSessionOutputMetadata(workingDirectory)
  let changed = false

  for (const [relativePath, file] of Object.entries(snapshot)) {
    if (!metadata.files[relativePath]) {
      metadata.files[relativePath] = { createdAt: file.createdAt }
      changed = true
    }
  }
  for (const relativePath of Object.keys(metadata.files)) {
    if (!snapshot[relativePath]) {
      delete metadata.files[relativePath]
      changed = true
    }
  }

  if (changed) await writeSessionOutputMetadata(workingDirectory, metadata)
  return metadata
}

export async function recordSessionOutputProvenance(options: {
  workingDirectory: string
  before: SessionOutputSnapshot
  skillId?: string | null
  sourceDocumentPath?: string
}): Promise<boolean> {
  const after = await captureSessionOutputSnapshot(options.workingDirectory)
  const metadata = await reconcileSessionOutputMetadata(options.workingDirectory, after)
  if (!options.skillId) return false

  let changed = false
  for (const [relativePath, file] of Object.entries(after)) {
    const previous = options.before[relativePath]
    const wasChanged = !previous
      || previous.size !== file.size
      || previous.modifiedAt !== file.modifiedAt
    if (!wasChanged) continue
    const fileType = artifactFileTypeFromPath(relativePath)
    if (artifactCategoryFromFileType(fileType) !== 'skill_output') continue
    const current = metadata.files[relativePath] || { createdAt: file.createdAt }
    metadata.files[relativePath] = {
      ...current,
      skillId: options.skillId,
      sourceDocumentPath: options.sourceDocumentPath,
    }
    changed = true
  }

  if (changed) await writeSessionOutputMetadata(options.workingDirectory, metadata)
  return changed
}

export async function removeSessionOutputMetadataEntry(
  workingDirectory: string,
  filePath: string,
): Promise<void> {
  const relativePath = relative(resolve(workingDirectory), resolve(filePath))
  if (!isSafeRelativePath(relativePath)) return
  const metadata = await readSessionOutputMetadata(workingDirectory)
  if (!metadata.files[relativePath]) return
  delete metadata.files[relativePath]
  await writeSessionOutputMetadata(workingDirectory, metadata)
}

export function sourceDocumentName(sourceDocumentPath?: string): string | undefined {
  return sourceDocumentPath ? basename(sourceDocumentPath) : undefined
}
