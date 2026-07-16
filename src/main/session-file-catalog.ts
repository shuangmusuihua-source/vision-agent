import { basename, resolve } from 'path'
import type { SessionOutputEntry } from '../shared/types'
import { artifactCategoryFromFileType, artifactFileTypeFromPath } from './artifact-utils'
import { isManagedSessionWorkingDirectory } from './session-files'
import { getKnowledgeBaseDir, store } from './persistence/store-core'
import { getKnowledgeSyncStates } from './knowledge-curation'
import {
  reconcileSessionOutputMetadata,
  scanSessionOutputs,
  sourceDocumentName,
} from './session-output-metadata'

const SESSION_FILE_MUTATING_TOOLS = new Set(['Write', 'Edit', 'NotebookEdit', 'Bash'])

export function isSessionFileMutationTool(toolName: string): boolean {
  return SESSION_FILE_MUTATING_TOOLS.has(toolName)
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
  const scan = await scanSessionOutputs(workingDirectory)
  const metadata = await reconcileSessionOutputMetadata(workingDirectory, scan.snapshot)
  const files: SessionOutputEntry[] = scan.files.map((file) => {
    const fileType = artifactFileTypeFromPath(file.filePath)
    const fileMetadata = metadata.files[file.relativePath]
    return {
      fileName: file.fileName,
      filePath: file.filePath,
      relativePath: file.relativePath,
      fileType,
      category: artifactCategoryFromFileType(fileType),
      availability: 'available',
      size: file.size,
      createdAt: fileMetadata?.createdAt || file.createdAt,
      modifiedAt: file.modifiedAt,
      provenance: fileMetadata?.skillId || fileMetadata?.sourceDocumentPath
        ? {
            skillId: fileMetadata.skillId,
            sourceDocumentPath: fileMetadata.sourceDocumentPath,
            sourceDocumentName: sourceDocumentName(fileMetadata.sourceDocumentPath),
          }
        : undefined,
    }
  })

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
