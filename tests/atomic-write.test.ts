import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { atomicWriteTextFile } from '../src/main/atomic-write'

const tempRoots: string[] = []

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'sumi-atomic-write-'))
  tempRoots.push(dir)
  return dir
}

async function tempFiles(dir: string): Promise<string[]> {
  return (await readdir(dir)).filter((name) => name.endsWith('.tmp'))
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('atomicWriteTextFile', () => {
  it('replaces an existing text file and removes the temporary file', async () => {
    const dir = await makeTempDir()
    const filePath = path.join(dir, 'note.md')
    await writeFile(filePath, 'before', 'utf8')

    await atomicWriteTextFile(filePath, 'after')

    await expect(readFile(filePath, 'utf8')).resolves.toBe('after')
    await expect(tempFiles(dir)).resolves.toEqual([])
  })

  it('creates a new text file atomically', async () => {
    const dir = await makeTempDir()
    const filePath = path.join(dir, 'new.md')

    await atomicWriteTextFile(filePath, 'fresh')

    await expect(readFile(filePath, 'utf8')).resolves.toBe('fresh')
    await expect(tempFiles(dir)).resolves.toEqual([])
  })

  it('cleans up the temporary file when replacement fails', async () => {
    const dir = await makeTempDir()
    const directoryTarget = path.join(dir, 'target.md')
    await mkdir(directoryTarget)

    await expect(atomicWriteTextFile(directoryTarget, 'nope')).rejects.toThrow()

    await expect(stat(directoryTarget).then((s) => s.isDirectory())).resolves.toBe(true)
    await expect(tempFiles(dir)).resolves.toEqual([])
  })
})
