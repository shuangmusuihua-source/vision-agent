import type { AgentEvent, AgentState } from '../../shared/types'
import { AGENT_TRANSITIONS } from '../../shared/types'
import type { ContextSlot } from './agent-store'
import { extractArtifactFromMessage } from './message-pipeline'

export function transition(current: AgentState, event: AgentEvent): AgentState {
  const allowed = AGENT_TRANSITIONS[current]?.[event.type]
  if (!allowed) {
    console.warn(`[AgentFSM] Invalid transition: ${current} + ${event.type}`)
    return current
  }
  return allowed
}

export function reduceAgentEvent(slot: ContextSlot, event: AgentEvent): Partial<ContextSlot> {
  const next = transition(slot.agentState, event)
  const slotUpdates: Partial<ContextSlot> = { agentState: next }

  if (event.type === 'SEND_MESSAGE') {
    slotUpdates._queryGeneration = (slot._queryGeneration || 0) + 1
  }

  if (event.type === 'ABORT') {
    slotUpdates._resultGuardGen = slot._queryGeneration || 0
  }

  if (slot.agentState === 'thinking' && next !== 'thinking') {
    slotUpdates.messages = slot.messages.filter(
      (message) => !(message.kind === 'status' && message.phase === 'streaming')
    )
  }

  if (event.type === 'RESULT_SUCCESS') {
    slotUpdates.isStreaming = false
    slotUpdates._acc = null
    slotUpdates._firstContentSeen = false
    slotUpdates.activeSkillId = null
    slotUpdates.generationActivity = null
    slotUpdates.todoList = null
    slotUpdates.permissionRequest = null
    slotUpdates.permissionQueue = []
    slotUpdates.askUserRequest = null
    slotUpdates.askUserQueue = []
    const messages = (slotUpdates.messages || slot.messages).map((message) =>
      message.kind === 'text' && message.phase !== 'complete' && message.phase !== 'error'
        ? { ...message, phase: 'complete' as const }
        : message
    )
    const skillId = slot.activeSkillId
    if (skillId) {
      for (let index = 0; index < messages.length; index++) {
        const message = messages[index]
        if ((message.kind === 'text' || message.kind === 'user') && message.skillMeta?.id === skillId) {
          messages[index] = {
            ...message,
            skillMeta: { ...message.skillMeta, status: 'completed' },
          } as typeof message
          break
        }
      }
    }
    const finalMessages = [...messages]
    const processedIds = new Set(slot._processedArtifactIds)
    for (let index = messages.length - 1; index >= 0; index--) {
      if (processedIds.has(messages[index].id)) continue
      const artifact = extractArtifactFromMessage(messages[index])
      if (artifact) {
        processedIds.add(messages[index].id)
        finalMessages.push({
          kind: 'artifact',
          id: `artifact-${Date.now()}-${index}`,
          role: 'assistant',
          artifact,
          createdAt: Date.now(),
        })
      }
    }
    slotUpdates._processedArtifactIds = processedIds
    slotUpdates.messages = finalMessages
  }

  if (event.type === 'RESULT_ERROR') {
    slotUpdates.isStreaming = false
    slotUpdates._acc = null
    slotUpdates._firstContentSeen = false
    slotUpdates.activeSkillId = null
    slotUpdates.generationActivity = null
    slotUpdates.todoList = null
    slotUpdates.permissionRequest = null
    slotUpdates.permissionQueue = []
    slotUpdates.askUserRequest = null
    slotUpdates.askUserQueue = []
    const messages = (slotUpdates.messages || slot.messages).map((message) =>
      message.kind === 'text' && message.phase !== 'complete' && message.phase !== 'stopped'
        ? { ...message, phase: 'error' as const }
        : message
    )
    const skillId = slot.activeSkillId
    if (skillId) {
      for (let index = 0; index < messages.length; index++) {
        const message = messages[index]
        if ((message.kind === 'text' || message.kind === 'user') && message.skillMeta?.id === skillId) {
          messages[index] = {
            ...message,
            skillMeta: { ...message.skillMeta, status: 'error' },
          } as typeof message
          break
        }
      }
    }
    slotUpdates.messages = messages
  }

  if (event.type === 'ABORT') {
    slotUpdates.isStreaming = false
    slotUpdates._acc = null
    slotUpdates._firstContentSeen = false
    slotUpdates.activeSkillId = null
    slotUpdates.generationActivity = null
    slotUpdates.todoList = null
    slotUpdates.permissionRequest = null
    slotUpdates.permissionQueue = []
    slotUpdates.askUserRequest = null
    slotUpdates.askUserQueue = []
    slotUpdates.messages = (slotUpdates.messages || slot.messages).map((message) =>
      message.kind === 'text' && message.phase !== 'complete' && message.phase !== 'error'
        ? { ...message, phase: 'complete' as const }
        : message
    )
  }

  return slotUpdates
}
