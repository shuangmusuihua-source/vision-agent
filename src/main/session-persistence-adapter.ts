import type { AgentContext } from '../shared/types'
import { addCompactionId } from './session-store'
import { addCompactionSessionId, addSessionRecord, getSessionRecordById } from './store'

type MaterializedSessionInput = {
  appSessionId: string
  sdkSessionId: string
  workspacePath: string
  workingDirectory?: string
  context: AgentContext
  title?: string
}

export function persistMaterializedSession(input: MaterializedSessionInput): void {
  const existing = getSessionRecordById(input.appSessionId)
  const now = Date.now()
  addSessionRecord({
    ...existing,
    id: input.appSessionId,
    sdkSessionId: input.sdkSessionId,
    workspacePath: input.workspacePath,
    workingDirectory: input.workingDirectory ?? existing?.workingDirectory,
    context: input.context,
    status: 'active',
    title: input.title ?? existing?.title,
    createdAt: existing?.createdAt ?? now,
    lastModified: now,
    messageCount: existing?.messageCount ?? 0,
  })
}

export function recordCompactionSessionId(sdkSessionId: string): void {
  addCompactionSessionId(sdkSessionId)
  addCompactionId(sdkSessionId)
}
