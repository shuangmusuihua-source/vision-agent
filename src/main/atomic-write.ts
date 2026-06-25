import { randomUUID } from 'crypto'
import { chmod, open, rename, stat, unlink } from 'fs/promises'
import { basename, dirname, join } from 'path'

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

export async function atomicWriteTextFile(filePath: string, content: string): Promise<void> {
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
