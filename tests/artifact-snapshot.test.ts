import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  createSessionArtifactSnapshot,
  removeSessionArtifactSnapshots,
} from '../src/main/artifact-snapshot'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('session artifact snapshots', () => {
  it('keeps different sessions isolated when the source path is overwritten', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sumi-artifacts-'))
    tempDirs.push(root)
    const sourcePath = join(root, 'report.md')
    const snapshotRoot = join(root, 'snapshots')

    await writeFile(sourcePath, 'session A')
    const first = await createSessionArtifactSnapshot({
      snapshotRoot,
      sessionId: 'session-a',
      artifactId: 'artifact-report',
      sourceFilePath: sourcePath,
      fileName: 'report.md',
    })

    await writeFile(sourcePath, 'session B')
    const second = await createSessionArtifactSnapshot({
      snapshotRoot,
      sessionId: 'session-b',
      artifactId: 'artifact-report',
      sourceFilePath: sourcePath,
      fileName: 'report.md',
    })

    expect(first).not.toBe(second)
    await expect(readFile(first, 'utf8')).resolves.toBe('session A')
    await expect(readFile(second, 'utf8')).resolves.toBe('session B')

    await removeSessionArtifactSnapshots(snapshotRoot, 'session-a')
    await expect(readFile(second, 'utf8')).resolves.toBe('session B')
  })
})
