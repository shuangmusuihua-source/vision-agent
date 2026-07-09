import { readdir, stat } from 'fs/promises'
import { basename, join, relative, resolve } from 'path'
import type { SessionOutputEntry } from '../shared/types'
import { artifactCategoryFromFileType, artifactFileTypeFromPath } from './artifact-utils'
import { isManagedSessionWorkingDirectory } from './session-files'
import { getKnowledgeBaseDir, store } from './persistence/store-core'
import { getKnowledgeSyncStates } from './knowledge-curation'
import {
  captureSessionOutputSnapshot,
  reconcileSessionOutputMetadata,
  sourceDocumentName,
  type SessionOutputMetadataFile,
} from './session-output-metadata'

const SESSION_FILE_MUTATING_TOOLS = new Set(['Write', 'Edit', 'NotebookEdit', 'Bash'])

export function isSessionFileMutationTool(toolName: string): boolean {
  return SESSION_FILE_MUTATING_TOOLS.has(toolName)
}

async function collectSessionFiles(
  root: string,
  directory: string,
  files: SessionOutputEntry[],
  metadata: SessionOutputMetadataFile,
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
      await collectSessionFiles(root, filePath, files, metadata)
      continue
    }
    if (!entry.isFile()) continue

    try {
      const fileStat = await stat(filePath)
      const fileType = artifactFileTypeFromPath(filePath)
      const relativePath = relative(root, filePath)
      const fileMetadata = metadata.files[relativePath]
      files.push({
        fileName: entry.name,
        filePath,
        relativePath,
        fileType,
        category: artifactCategoryFromFileType(fileType),
        availability: 'available',
        size: fileStat.size,
        createdAt: fileMetadata?.createdAt || fileStat.birthtimeMs || fileStat.ctimeMs || fileStat.mtimeMs,
        modifiedAt: fileStat.mtimeMs,
        provenance: fileMetadata?.skillId || fileMetadata?.sourceDocumentPath
          ? {
              skillId: fileMetadata.skillId,
              sourceDocumentPath: fileMetadata.sourceDocumentPath,
              sourceDocumentName: sourceDocumentName(fileMetadata.sourceDocumentPath),
            }
          : undefined,
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

  const workingDirectory = resolve(record.workingDirectory)
  const snapshot = await captureSessionOutputSnapshot(workingDirectory)
  const metadata = await reconcileSessionOutputMetadata(workingDirectory, snapshot)
  const files: SessionOutputEntry[] = []
  await collectSessionFiles(workingDirectory, workingDirectory, files, metadata)

  const documents = files.filter((file) => file.fileType === 'md')
  const knowledgeStates = await getKnowledgeSyncStates(
    documents.map((file) => file.filePath),
    getKnowledgeBaseDir(),
  )
  for (const document of documents) {
    document.knowledge = knowledgeStates.get(document.filePath) || { status: 'not_added' }
  }

  const markdownByBaseName = documents
    .map((document) => ({
      baseName: basename(document.fileName, `.${document.fileName.split('.').pop() || ''}`).toLocaleLowerCase(),
      document,
    }))
    .sort((a, b) => b.baseName.length - a.baseName.length)
  for (const file of files) {
    if (file.category !== 'skill_output' || file.provenance?.sourceDocumentPath) continue
    const artifactBaseName = basename(
      file.fileName,
      `.${file.fileName.split('.').pop() || ''}`,
    ).toLocaleLowerCase()
    const matchingDocument = markdownByBaseName.find(({ baseName }) => (
      artifactBaseName === baseName
      || artifactBaseName.startsWith(`${baseName}-`)
      || artifactBaseName.startsWith(`${baseName}_`)
      || artifactBaseName.startsWith(`${baseName} `)
      || artifactBaseName.startsWith(`${baseName}（`)
      || artifactBaseName.startsWith(`${baseName}(`)
    ))?.document
    if (matchingDocument) {
      file.provenance = {
        ...file.provenance,
        sourceDocumentPath: matchingDocument.filePath,
        sourceDocumentName: matchingDocument.fileName,
      }
    }
  }

  return files.sort((a, b) => b.modifiedAt - a.modifiedAt || a.fileName.localeCompare(b.fileName))
}
