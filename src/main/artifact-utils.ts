import { extname } from 'path'
import type { ArtifactFileType, SessionOutputEntry } from '../shared/types'

export function artifactFileTypeFromPath(filePath: string): ArtifactFileType {
  const ext = extname(filePath).slice(1).toLowerCase()
  if (ext === 'html' || ext === 'htm') return 'html'
  if (ext === 'svg') return 'svg'
  if (ext === 'json') return 'json'
  if (ext === 'png' || ext === 'jpg' || ext === 'jpeg') return 'png'
  if (ext === 'pdf') return 'pdf'
  if (ext === 'docx') return 'docx'
  if (ext === 'pptx') return 'pptx'
  if (ext === 'xlsx') return 'xlsx'
  if (ext === 'md' || ext === 'markdown') return 'md'
  return 'other'
}

export function artifactCategoryFromFileType(
  fileType: ArtifactFileType
): SessionOutputEntry['category'] {
  if (
    fileType === 'html'
    || fileType === 'svg'
    || fileType === 'pdf'
    || fileType === 'docx'
    || fileType === 'pptx'
    || fileType === 'xlsx'
  ) return 'skill_output'
  if (fileType === 'md' || fileType === 'json' || fileType === 'png') return 'document'
  return 'other'
}
