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

export interface ScannedSessionOutput {
  fileName: string
  filePath: string
  relativePath: string
  size: number
  modifiedAt: number
  createdAt: number
}

export interface SessionOutputScan {
  snapshot: SessionOutputSnapshot
  files: ScannedSessionOutput[]
}

const metadataMutationTails = new Map<string, Promise<void>>()

function isSafeRelativePath(value: string): boolean {
  return Boolean(value)
    && value !== '..'
    && !value.startsWith(`..${sep}`)
    && !value.split(sep).some((part) => part.startsWith('.'))
}

async function collectSessionOutputs(
  root: string,
  directory: string,
  scan: SessionOutputScan,
): Promise<void> {
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
      await collectSessionOutputs(root, filePath, scan)
      continue
    }
    if (!entry.isFile()) continue
    try {
      const fileStat = await stat(filePath)
      const relativePath = relative(root, filePath)
      if (!isSafeRelativePath(relativePath)) continue
      const createdAt = fileStat.birthtimeMs || fileStat.ctimeMs || fileStat.mtimeMs
      scan.snapshot[relativePath] = {
        size: fileStat.size,
        modifiedAt: fileStat.mtimeMs,
        createdAt,
      }
      scan.files.push({
        fileName: entry.name,
        filePath,
        relativePath,
        size: fileStat.size,
        modifiedAt: fileStat.mtimeMs,
        createdAt,
      })
    } catch {
      // Files may be atomically replaced while the SDK is writing them.
    }
  }
}

export async function scanSessionOutputs(workingDirectory: string): Promise<SessionOutputScan> {
  const root = resolve(workingDirectory)
  const scan: SessionOutputScan = { snapshot: {}, files: [] }
  await collectSessionOutputs(root, root, scan)
  return scan
}

export async function captureSessionOutputSnapshot(workingDirectory: string): Promise<SessionOutputSnapshot> {
  return (await scanSessionOutputs(workingDirectory)).snapshot
}

export async function readSessionOutputMetadata(workingDirectory: string): Promise<SessionOutputMetadataFile> {
  try {
    const parsed = JSON.parse(await readFile(join(workingDirectory, METADATA_FILE_NAME), 'utf8')) as SessionOutputMetadataFile
    if (parsed.version === 1 && parsed.files && typeof parsed.files === 'object') return parsed
  } catch {
    // First use or malformed metadata: rebuild from the file system.
  }
  return { version: 1, files: {} }
}

async function writeSessionOutputMetadata(
  workingDirectory: string,
  metadata: SessionOutputMetadataFile,
): Promise<void> {
  await mkdir(workingDirectory, { recursive: true })
  await atomicWriteTextFile(
    join(workingDirectory, METADATA_FILE_NAME),
    `${JSON.stringify(metadata, null, 2)}\n`,
  )
}

async function withMetadataMutation<T>(
  workingDirectory: string,
  mutation: () => Promise<T>,
): Promise<T> {
  const key = resolve(workingDirectory)
  const previous = metadataMutationTails.get(key) || Promise.resolve()
  let releaseTurn!: () => void
  const turn = new Promise<void>((resolveTurn) => {
    releaseTurn = resolveTurn
  })
  const tail = previous.catch(() => undefined).then(() => turn)
  metadataMutationTails.set(key, tail)

  await previous.catch(() => undefined)
  try {
    return await mutation()
  } finally {
    releaseTurn()
    if (metadataMutationTails.get(key) === tail) metadataMutationTails.delete(key)
  }
}

function applySnapshotToMetadata(
  metadata: SessionOutputMetadataFile,
  snapshot: SessionOutputSnapshot,
): boolean {
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

  return changed
}

export async function reconcileSessionOutputMetadata(
  workingDirectory: string,
  snapshot: SessionOutputSnapshot,
): Promise<SessionOutputMetadataFile> {
  return withMetadataMutation(workingDirectory, async () => {
    const metadata = await readSessionOutputMetadata(workingDirectory)
    if (applySnapshotToMetadata(metadata, snapshot)) {
      await writeSessionOutputMetadata(workingDirectory, metadata)
    }
    return metadata
  })
}

export async function recordSessionOutputProvenance(options: {
  workingDirectory: string
  before: SessionOutputSnapshot
  skillId?: string | null
  sourceDocumentPath?: string
}): Promise<boolean> {
  const after = await captureSessionOutputSnapshot(options.workingDirectory)
  return withMetadataMutation(options.workingDirectory, async () => {
    const metadata = await readSessionOutputMetadata(options.workingDirectory)
    let metadataChanged = applySnapshotToMetadata(metadata, after)
    let provenanceChanged = false

    if (options.skillId) {
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
        provenanceChanged = true
        metadataChanged = true
      }
    }

    if (metadataChanged) {
      await writeSessionOutputMetadata(options.workingDirectory, metadata)
    }
    return provenanceChanged
  })
}

export async function removeSessionOutputMetadataEntry(
  workingDirectory: string,
  filePath: string,
): Promise<void> {
  const relativePath = relative(resolve(workingDirectory), resolve(filePath))
  if (!isSafeRelativePath(relativePath)) return
  await withMetadataMutation(workingDirectory, async () => {
    const metadata = await readSessionOutputMetadata(workingDirectory)
    if (!metadata.files[relativePath]) return
    delete metadata.files[relativePath]
    await writeSessionOutputMetadata(workingDirectory, metadata)
  })
}

export function sourceDocumentName(sourceDocumentPath?: string): string | undefined {
  return sourceDocumentPath ? basename(sourceDocumentPath) : undefined
}
