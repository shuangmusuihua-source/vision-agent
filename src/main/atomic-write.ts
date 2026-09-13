import { randomUUID } from 'crypto'
import { chmod, open, readFile, rename, stat, unlink } from 'fs/promises'
import { basename, dirname, join, resolve } from 'path'

const pendingWrites = new Map<string, Promise<void>>()

async function syncDirectoryBestEffort(dirPath: string): Promise<void> {
  let handle: Awaited<ReturnType<typeof open>> | null = null
  try {
    handle = await open(dirPath, 'r')
    await handle.sync()
  } catch {
    // Directory fsync is platform/filesystem dependent. The file fsync above is
    // the critical durability step; directory sync is a best-effort extra.
  } finally {
    await handle?.close().catch(() => {})
  }
}

async function existingMode(filePath: string): Promise<number | null> {
  try {
    return (await stat(filePath)).mode & 0o777
  } catch {
    return null
  }
}

export function atomicWriteTextFile(filePath: string, content: string): Promise<void> {
  return enqueueFileWrite(filePath, () => replaceTextFile(resolve(filePath), content))
}

/** Compare inside the same queue used by editor saves, before replacing a draft's source. */
export function atomicCompareWriteTextFile(filePath: string, expected: string | null, content: string | null): Promise<void> {
  return enqueueFileWrite(filePath, async () => {
    let current: string | null
    try { current = await readFile(filePath, 'utf8') } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      current = null
    }
    if (current !== expected) throw new Error('文件已发生变化，请重新生成或合并后再保存')
    if (content === null) {
      if (current !== null) await unlink(filePath)
    } else await replaceTextFile(resolve(filePath), content)
  })
}

function enqueueFileWrite(filePath: string, operation: () => Promise<void>): Promise<void> {
  const key = resolve(filePath)
  const previous = pendingWrites.get(key) ?? Promise.resolve()
  const write = previous.catch(() => undefined).then(operation)
  pendingWrites.set(key, write)
  const cleanup = () => {
    if (pendingWrites.get(key) === write) pendingWrites.delete(key)
  }
  void write.then(cleanup, cleanup)
  return write
}

async function replaceTextFile(filePath: string, content: string): Promise<void> {
  const dir = dirname(filePath)
  const tempPath = join(dir, `.${basename(filePath)}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`)
  const mode = await existingMode(filePath)

  try {
    const handle = await open(tempPath, 'w', mode ?? 0o666)
    try {
      await handle.writeFile(content, { encoding: 'utf8' })
      await handle.sync()
    } finally {
      await handle.close()
    }

    if (mode !== null) {
      await chmod(tempPath, mode)
    }

    await rename(tempPath, filePath)
    await syncDirectoryBestEffort(dir)
  } catch (err) {
    await unlink(tempPath).catch(() => {})
    throw err
  }
}
