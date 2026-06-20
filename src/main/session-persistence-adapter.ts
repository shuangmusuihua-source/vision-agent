import type { AgentContext } from '../shared/types'
import { registerSession } from './agent-sessions'
import { addCompactionId } from './session-store'
import { addCompactionSessionId, addSessionRecord } from './store'

type MaterializedSessionInput = {
  appSessionId: string
  sdkSessionId: string
  workspacePath: string
  context: AgentContext
}

export function persistMaterializedSession(input: MaterializedSessionInput): void {
  registerSession(input.sdkSessionId, input.workspacePath)
  addSessionRecord({
    id: input.appSessionId,
    sdkSessionId: input.sdkSessionId,
    workspacePath: input.workspacePath,
    context: input.context,
    status: 'active',
    createdAt: Date.now(),
    lastModified: Date.now(),
    messageCount: 0,
    artifactCount: 0,
  })
}

export function recordCompactionSessionId(sdkSessionId: string): void {
  addCompactionSessionId(sdkSessionId)
  addCompactionId(sdkSessionId)
}
