import { readdir, stat } from 'fs/promises'
import { join } from 'path'
import type { SessionOutputEntry } from '../shared/types'
import { artifactCategoryFromFileType, artifactFileTypeFromPath } from './artifact-utils'
import { isManagedSessionWorkingDirectory } from './session-files'
import { store } from './persistence/store-core'

const SESSION_FILE_MUTATING_TOOLS = new Set(['Write', 'Edit', 'NotebookEdit', 'Bash'])

export function isSessionFileMutationTool(toolName: string): boolean {
  return SESSION_FILE_MUTATING_TOOLS.has(toolName)
}

async function collectSessionFiles(directory: string, files: SessionOutputEntry[]): Promise<void> {
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
      await collectSessionFiles(filePath, files)
      continue
    }
    if (!entry.isFile()) continue

    try {
      const fileStat = await stat(filePath)
      const fileType = artifactFileTypeFromPath(filePath)
      files.push({
        fileName: entry.name,
        filePath,
        fileType,
        category: artifactCategoryFromFileType(fileType),
        availability: 'available',
        size: fileStat.size,
        createdAt: fileStat.birthtimeMs || fileStat.ctimeMs || fileStat.mtimeMs,
      })
    } catch {
      // The file may have been replaced while the directory was being read.
    }
  }
}

export async function getSessionFileOutputs(sessionId: string): Promise<SessionOutputEntry[]> {
  const record = store.get('sessions').find((session) => (
    session.id === sessionId || session.sdkSessionId === sessionId
  ))
  if (
    !record?.workingDirectory
    || record.context !== 'editor'
    || !isManagedSessionWorkingDirectory(record.workspacePath, record.workingDirectory)
  ) {
    return []
  }

  const files: SessionOutputEntry[] = []
  await collectSessionFiles(record.workingDirectory, files)
  return files.sort((a, b) => b.createdAt - a.createdAt || a.fileName.localeCompare(b.fileName))
}
