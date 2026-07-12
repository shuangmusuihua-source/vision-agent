import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import {
  deleteMemoryDocument,
  listMemoryEntries,
  readMemoryDocument,
  resolveManagedMemoryPath,
  updateMemoryDocument,
} from '../src/main/memory-files'

const tempRoots: string[] = []

async function createMemoryDirectory(name: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), `sumi-global-memory-${name}-`))
  tempRoots.push(root)
  const memoryDirectory = path.join(root, 'memory')
  await mkdir(memoryDirectory)
  return memoryDirectory
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('global memory file management', () => {
  it('lists the core index before topic memories and returns no entries before initialization', async () => {
    const absentRoot = path.join(await mkdtemp(path.join(tmpdir(), 'sumi-global-memory-absent-')), 'memory')
    tempRoots.push(path.dirname(absentRoot))
    await expect(listMemoryEntries(absentRoot)).resolves.toEqual([])

    const memoryDirectory = await createMemoryDirectory('list')
    await writeFile(path.join(memoryDirectory, 'preference.md'), 'topic')
    await writeFile(path.join(memoryDirectory, 'MEMORY.md'), '- [偏好](preference.md)')

    const entries = await listMemoryEntries(memoryDirectory)

    expect(entries).toHaveLength(2)
    expect(entries.map((entry) => entry.kind)).toEqual(['index', 'topic'])
    expect(entries.map((entry) => entry.name)).toEqual(['MEMORY', 'preference'])
  })

  it('reads, atomically updates, and deletes a managed global memory', async () => {
    const memoryDirectory = await createMemoryDirectory('managed')
    const filePath = path.join(memoryDirectory, 'note.md')
    await writeFile(filePath, 'before')

    await expect(readMemoryDocument(filePath, memoryDirectory)).resolves.toMatchObject({ content: 'before', kind: 'topic' })
    await expect(updateMemoryDocument(filePath, 'after', memoryDirectory)).resolves.toMatchObject({ content: 'after' })
    await expect(readFile(filePath, 'utf8')).resolves.toBe('after')
    await deleteMemoryDocument(filePath, memoryDirectory)
    await expect(readFile(filePath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('allows the core MEMORY.md index to be audited and edited', async () => {
    const memoryDirectory = await createMemoryDirectory('index')
    const indexPath = path.join(memoryDirectory, 'MEMORY.md')
    await writeFile(indexPath, '# Index')

    expect(resolveManagedMemoryPath(indexPath, memoryDirectory)).toBe(indexPath)
    await expect(updateMemoryDocument(indexPath, '# Updated', memoryDirectory))
      .resolves.toMatchObject({ kind: 'index', content: '# Updated' })
  })

  it('rejects traversal, nested files, and symbolic-link files', async () => {
    const memoryDirectory = await createMemoryDirectory('secure')
    const root = path.dirname(memoryDirectory)
    const outside = path.join(root, 'outside.md')
    const nested = path.join(memoryDirectory, 'nested', 'note.md')
    const linked = path.join(memoryDirectory, 'linked.md')
    await writeFile(outside, 'outside')
    await mkdir(path.dirname(nested), { recursive: true })
    await writeFile(nested, 'nested')
    await symlink(outside, linked)

    expect(resolveManagedMemoryPath(outside, memoryDirectory)).toBeNull()
    expect(resolveManagedMemoryPath(nested, memoryDirectory)).toBeNull()
    await expect(readMemoryDocument(linked, memoryDirectory)).rejects.toThrow('regular file')
  })

  it('does not follow a global memory directory symbolic link', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sumi-global-memory-link-root-'))
    const outside = await mkdtemp(path.join(tmpdir(), 'sumi-global-memory-link-target-'))
    tempRoots.push(root, outside)
    await writeFile(path.join(outside, 'private.md'), 'outside')
    const linkedDirectory = path.join(root, 'memory')
    await symlink(outside, linkedDirectory)

    await expect(listMemoryEntries(linkedDirectory)).rejects.toThrow('regular directory')
    await expect(readMemoryDocument(path.join(linkedDirectory, 'private.md'), linkedDirectory))
      .rejects.toThrow('regular directory')
  })
})
