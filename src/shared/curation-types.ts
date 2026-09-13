export interface KnowledgeDocument {
  path: string
  title: string
  description: string
  kind: 'source' | 'topic'
  modifiedAt: number
  status: 'new' | 'current' | 'changed'
  unavailableReason?: string
}

export interface KnowledgeCatalog {
  documents: KnowledgeDocument[]
  canUndo: boolean
}

export interface CurationDraftFile {
  id: string
  title: string
  before: string | null
  content: string
}

export interface CurationDraft {
  id: string
  kind: 'knowledge' | 'skill'
  title: string
  files: CurationDraftFile[]
  notice?: string
}

export interface KnowledgePrepareRequest {
  requestId: string
  paths: string[]
  sessionId?: string
}

export interface PersonalSkillPrepareRequest {
  requestId: string
  sessionId: string
  artifactPath?: string
  instruction: string
  skillId?: string
}

export interface CurationSaveRequest {
  draftId: string
  files: Array<{ id: string; content: string }>
}

export type CurationResult<T> = { success: true; value: T } | { success: false; error: string }

export interface PersonalSkillSummary {
  id: string
  name: string
  description: string
  updatedAt: number
  enabled: boolean
}
