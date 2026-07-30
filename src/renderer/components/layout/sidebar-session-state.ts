import type { ContextSlot } from '../../store/agent-store'
import { isAgentQueryActive } from '../../store/agent-state-machine'

export type SidebarSessionIndicator =
  | ''
  | 'running'
  | `permission:${number}`
  | `askUser:${number}`

export type SidebarSessionAttention = {
  type: 'permission' | 'askUser'
  count: number
  label: string
}

export function projectSidebarSessionIndicator(
  slot?: ContextSlot | null,
): SidebarSessionIndicator {
  if (!slot) return ''

  const permissionCount = (slot.permissionRequest ? 1 : 0) + slot.permissionQueue.length
  if (permissionCount > 0) return `permission:${permissionCount}`

  const askUserCount = (slot.askUserRequest ? 1 : 0) + slot.askUserQueue.length
  if (askUserCount > 0) return `askUser:${askUserCount}`

  return isAgentQueryActive(slot.agentState) ? 'running' : ''
}

export function buildSidebarSessionIndicators(
  sessionIds: string[],
  sessionSlots: Record<string, ContextSlot>,
): Record<string, SidebarSessionIndicator> {
  return Object.fromEntries(sessionIds.map((sessionId) => [
    sessionId,
    projectSidebarSessionIndicator(sessionSlots[sessionId]),
  ]))
}

export function getSidebarSessionAttention(
  indicator: SidebarSessionIndicator,
): SidebarSessionAttention | null {
  if (indicator.startsWith('permission:')) {
    return {
      type: 'permission',
      count: Number(indicator.slice('permission:'.length)),
      label: '等待权限确认',
    }
  }
  if (indicator.startsWith('askUser:')) {
    return {
      type: 'askUser',
      count: Number(indicator.slice('askUser:'.length)),
      label: '等待你回答',
    }
  }
  return null
}
