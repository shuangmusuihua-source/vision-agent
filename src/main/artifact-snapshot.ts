import { copyFile, mkdir, rename, rm } from 'fs/promises'
import { createHash, randomUUID } from 'crypto'
import { basename, dirname, join } from 'path'

function sessionStorageKey(sessionId: string): string {
  return createHash('sha1').update(sessionId).digest('hex').slice(0, 20)
}

export function getSessionArtifactSnapshotDir(snapshotRoot: string, sessionId: string): string {
  return join(snapshotRoot, sessionStorageKey(sessionId))
}

export function getSessionArtifactSnapshotPath(
  snapshotRoot: string,
  sessionId: string,
  artifactId: string,
  fileName: string,
): string {
  return join(getSessionArtifactSnapshotDir(snapshotRoot, sessionId), artifactId, basename(fileName))
}

export async function createSessionArtifactSnapshot(options: {
  snapshotRoot: string
  sessionId: string
  artifactId: string
  sourceFilePath: string
  fileName: string
}): Promise<string> {
  const snapshotPath = getSessionArtifactSnapshotPath(
    options.snapshotRoot,
    options.sessionId,
    options.artifactId,
    options.fileName,
  )
  const snapshotDir = dirname(snapshotPath)
  const tempPath = join(snapshotDir, `.${basename(snapshotPath)}.${randomUUID()}.tmp`)
  await mkdir(snapshotDir, { recursive: true })
  try {
    await copyFile(options.sourceFilePath, tempPath)
    await rename(tempPath, snapshotPath)
  } finally {
    await rm(tempPath, { force: true }).catch(() => {})
  }
  return snapshotPath
}

export async function removeSessionArtifactSnapshots(
  snapshotRoot: string,
  sessionId: string,
): Promise<void> {
  await rm(getSessionArtifactSnapshotDir(snapshotRoot, sessionId), { recursive: true, force: true })
}
