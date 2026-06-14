import type { AgentContext, AgentSessionEnvelope } from '../shared/types'

export function createSessionEnvelope(input: {
  context: AgentContext
  sessionId: string
  workspacePath: string
  sdkSessionId?: string
}): AgentSessionEnvelope {
  return {
    context: input.context,
    sessionId: input.sessionId,
    clientSessionKey: input.sessionId,
    sdkSessionId: input.sdkSessionId || undefined,
    workspacePath: input.workspacePath,
  }
}

export function withSessionEnvelope<T extends Record<string, unknown>>(
  envelope: AgentSessionEnvelope,
  payload: T
): T & AgentSessionEnvelope {
  return {
    ...payload,
    ...envelope,
  }
}
