import { createHash } from 'crypto'
import { lstat, mkdir, open } from 'fs/promises'
import { constants } from 'fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'path'
import { atomicCompareWriteTextFile } from './atomic-write'

export interface TextSnapshot { path: string; content: string | null; hash: string | null }
// A 200,000-character draft can exceed 512 KB when it contains Chinese text.
export const CURATION_TEXT_MAX_BYTES = 1_000_000
export const textHash = (text: string): string => createHash('sha256').update(text).digest('hex')

/** Validate every existing segment; lexical containment alone permits symlink escapes. */
export async function assertCurationPath(root: string, filePath: string): Promise<string> {
  const base = resolve(root)
  const target = resolve(filePath)
  const rel = relative(base, target)
  if (!rel || isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) throw new Error('文件不在允许的目录内')
  let current = base
  for (const part of ['', ...rel.split(sep)]) {
    if (part) current = resolve(current, part)
    try {
      const entry = await lstat(current)
      if (entry.isSymbolicLink()) throw new Error('整理文件不能使用符号链接')
      if (current !== target && !entry.isDirectory()) throw new Error('文件目录不可用')
      if (current === target && !entry.isFile()) throw new Error('只能处理普通文件')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  return target
}

export async function readTextSnapshot(root: string, path: string, maxBytes = CURATION_TEXT_MAX_BYTES): Promise<TextSnapshot> {
  await assertCurationPath(root, path)
  let handle
  try { handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { path, content: null, hash: null }
    throw error
  }
  try {
    const stat = await handle.stat()
    if (!stat.isFile() || stat.size > maxBytes) throw new Error('文件过大或不是可读取的文本文件')
    const content = await handle.readFile('utf8')
    return { path, content, hash: textHash(content) }
  } finally { await handle.close() }
}

export async function replaceSnapshot(root: string, previous: TextSnapshot, content: string | null): Promise<void> {
  await assertCurationPath(root, previous.path)
  await mkdir(dirname(previous.path), { recursive: true })
  await assertCurationPath(root, previous.path)
  await atomicCompareWriteTextFile(previous.path, previous.content, content)
}

export async function assertSnapshotsCurrent(root: string, snapshots: TextSnapshot[]): Promise<void> {
  for (const snapshot of snapshots) {
    const current = await readTextSnapshot(root, snapshot.path)
    if (current.hash !== snapshot.hash) throw new Error('资料或主题已更新，请重新整理后再保存')
  }
}
