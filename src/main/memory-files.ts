import { existsSync } from 'fs'
import { lstat, readFile, readdir, realpath, stat, unlink } from 'fs/promises'
import path from 'path'
import type { MemoryDocument, MemoryEntry, MemoryKind } from '../shared/types'
import { atomicWriteTextFile } from './atomic-write'

function memoryKind(fileName: string): MemoryKind {
  return fileName === 'MEMORY.md' ? 'index' : 'topic'
}

function entryName(fileName: string): string {
  return fileName.replace(/\.md$/i, '')
}

async function assertMemoryDirectory(memoryDirectory: string): Promise<string> {
  const resolvedDirectory = path.resolve(memoryDirectory)
  const directoryStat = await lstat(resolvedDirectory)
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
    throw new Error('Global memory directory must be a regular directory')
  }
  return realpath(resolvedDirectory)
}

export function resolveManagedMemoryPath(filePath: string, memoryDirectory: string): string | null {
  const resolved = path.resolve(filePath)
  const fileName = path.basename(resolved)
  if (path.extname(fileName).toLowerCase() !== '.md') return null
  return path.dirname(resolved) === path.resolve(memoryDirectory) ? resolved : null
}

async function assertManagedRegularFile(filePath: string, memoryDirectory: string): Promise<string> {
  const resolved = resolveManagedMemoryPath(filePath, memoryDirectory)
  if (!resolved) throw new Error('Path must be a managed global memory file')
  const [fileStat, fileRealPath, directoryRealPath] = await Promise.all([
    lstat(resolved),
    realpath(resolved),
    assertMemoryDirectory(memoryDirectory),
  ])
  if (!fileStat.isFile() || fileStat.isSymbolicLink()) throw new Error('Memory path must be a regular file')
  if (path.dirname(fileRealPath) !== directoryRealPath) throw new Error('Memory file must remain within the global memory directory')
  return resolved
}

export async function listMemoryEntries(memoryDirectory: string): Promise<MemoryEntry[]> {
  if (!existsSync(memoryDirectory)) return []
  await assertMemoryDirectory(memoryDirectory)
  const entries = await readdir(memoryDirectory, { withFileTypes: true })
  const results = await Promise.all(entries
    .filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === '.md')
    .map(async (entry): Promise<MemoryEntry> => {
      const filePath = path.join(memoryDirectory, entry.name)
      const fileStat = await stat(filePath)
      return {
        name: entryName(entry.name),
        path: filePath,
        kind: memoryKind(entry.name),
        modifiedAt: fileStat.mtimeMs,
        size: fileStat.size,
      }
    }))

  return results.sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === 'index' ? -1 : 1
    return right.modifiedAt - left.modifiedAt || left.name.localeCompare(right.name)
  })
}

export async function readMemoryDocument(filePath: string, memoryDirectory: string): Promise<MemoryDocument> {
  const resolved = await assertManagedRegularFile(filePath, memoryDirectory)
  const [content, fileStat] = await Promise.all([readFile(resolved, 'utf8'), stat(resolved)])
  const fileName = path.basename(resolved)
  return {
    name: entryName(fileName),
    path: resolved,
    kind: memoryKind(fileName),
    modifiedAt: fileStat.mtimeMs,
    size: fileStat.size,
    content,
  }
}

export async function updateMemoryDocument(filePath: string, content: string, memoryDirectory: string): Promise<MemoryDocument> {
  const resolved = await assertManagedRegularFile(filePath, memoryDirectory)
  await atomicWriteTextFile(resolved, content)
  return readMemoryDocument(resolved, memoryDirectory)
}

export async function deleteMemoryDocument(filePath: string, memoryDirectory: string): Promise<void> {
  const resolved = await assertManagedRegularFile(filePath, memoryDirectory)
  await unlink(resolved)
}
