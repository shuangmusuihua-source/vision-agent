import type {
  AgentContext,
  AskUserRequestIPC,
  PermissionRequestIPC,
} from '../../shared/types'
import type { AgentStore, ContextSlot } from './agent-store'
import { emptySlot } from './agent-store'

const MAX_SESSION_SLOTS = 30

type CacheOptions = {
  removeIds?: string[]
  protectIds?: Array<string | null | undefined>
}

export type AskUserTarget = {
  context: AgentContext
  sessionId: string | null
}

function collectProtectedIds(
  state: AgentStore,
  extra: Array<string | null | undefined> = [],
): Set<string> {
  const protectedIds = new Set<string>()
  for (const sessionId of [
    state.activeSessionId.editor,
    state.activeSessionId.ask,
    state.slots.editor.currentSessionId,
    state.slots.ask.currentSessionId,
    ...extra,
  ]) {
    if (sessionId) protectedIds.add(sessionId)
  }
  return protectedIds
}

/**
 * Store one session slot, update recency, remove aliases, and enforce the
 * cache limit without evicting a session bound to a live context.
 */
export function cacheSessionSlot(
  state: AgentStore,
  sessionId: string,
  slot: ContextSlot,
  options: CacheOptions = {},
): Pick<AgentStore, 'sessionSlots' | 'sessionAccessOrder'> {
  const removeIds = new Set((options.removeIds || []).filter((id) => id !== sessionId))
  const sessionSlots = { ...state.sessionSlots, [sessionId]: slot }
  for (const id of removeIds) delete sessionSlots[id]

  let sessionAccessOrder = state.sessionAccessOrder
    .filter((id) => id !== sessionId && !removeIds.has(id))
  sessionAccessOrder.push(sessionId)

  if (sessionAccessOrder.length <= MAX_SESSION_SLOTS) {
    return { sessionSlots, sessionAccessOrder }
  }

  const protectedIds = collectProtectedIds(state, [sessionId, ...(options.protectIds || [])])
  const evictCount = sessionAccessOrder.length - MAX_SESSION_SLOTS
  let evicted = 0
  const remainingOrder: string[] = []
  for (const candidateId of sessionAccessOrder) {
    if (evicted < evictCount && !protectedIds.has(candidateId)) {
      delete sessionSlots[candidateId]
      evicted++
    } else {
      remainingOrder.push(candidateId)
    }
  }
  sessionAccessOrder = remainingOrder

  if (evicted > 0) {
    console.info(`[AgentStore] LRU evicted ${evicted} session slot(s) (limit: ${MAX_SESSION_SLOTS})`)
  }
  return { sessionSlots, sessionAccessOrder }
}

export function resolveSessionSlot(
  state: AgentStore,
  context: AgentContext,
  eventSessionId?: string | null,
): ContextSlot {
  const sessionId = normalizeSessionId(eventSessionId)
  const liveSessionId = state.slots[context]?.currentSessionId
  if (
    !sessionId ||
    sessionId === state.activeSessionId[context] ||
    sessionId === liveSessionId
  ) {
    return state.slots[context]
  }
  return state.sessionSlots[sessionId] || state.slots[context]
}

export function patchSessionSlot(
  state: AgentStore,
  context: AgentContext,
  patch: Partial<ContextSlot>,
  eventSessionId?: string | null,
): Partial<AgentStore> {
  const sessionId = normalizeSessionId(eventSessionId)
  if (!sessionId) {
    return {
      slots: {
        ...state.slots,
        [context]: { ...state.slots[context], ...patch },
      },
    }
  }

  const cachedSlot = state.sessionSlots[sessionId] || emptySlot()
  const cachePatch = cacheSessionSlot(state, sessionId, { ...cachedSlot, ...patch })
  return {
    ...cachePatch,
    ...(sessionId === state.activeSessionId[context]
      ? { slots: { ...state.slots, [context]: { ...state.slots[context], ...patch } } }
      : {}),
  }
}

export function normalizeSessionId(sessionId?: string | null): string | null {
  if (!sessionId || sessionId === 'editor' || sessionId === 'ask') return null
  return sessionId
}

export function resolveClientSessionId(
  state: AgentStore,
  sessionId?: string | null,
): string | null {
  const normalized = normalizeSessionId(sessionId)
  if (!normalized) return null
  if (
    state.sessionSlots[normalized] ||
    state.activeSessionId.editor === normalized ||
    state.activeSessionId.ask === normalized ||
    state.slots.editor.currentSessionId === normalized ||
    state.slots.ask.currentSessionId === normalized
  ) {
    return normalized
  }

  for (const [clientId, slot] of Object.entries(state.sessionSlots)) {
    if (slot.sdkSessionId === normalized) return clientId
  }
  return state.sessionList.find((session) => session.sdkSessionId === normalized)?.id || normalized
}

export function getSdkSessionIdForClient(
  state: AgentStore,
  sessionId: string | null,
): string | null {
  const normalized = normalizeSessionId(sessionId)
  if (!normalized) return null
  const cached = state.sessionSlots[normalized]
  if (cached?.sdkSessionId) return cached.sdkSessionId

  const activeContext: AgentContext | null =
    state.activeSessionId.editor === normalized ? 'editor' :
      state.activeSessionId.ask === normalized ? 'ask' : null
  if (activeContext && state.slots[activeContext].sdkSessionId) {
    return state.slots[activeContext].sdkSessionId
  }

  const listed = state.sessionList.find((session) => session.id === normalized)
  if (listed?.sdkSessionId) return listed.sdkSessionId
  return normalized.startsWith('new-') ? null : normalized
}

export function contextForSession(
  state: AgentStore,
  sessionId: string | null,
  fallback: AgentContext,
): AgentContext {
  if (!sessionId) return fallback
  if (
    state.activeSessionId.editor === sessionId ||
    state.slots.editor.currentSessionId === sessionId
  ) return 'editor'
  if (
    state.activeSessionId.ask === sessionId ||
    state.slots.ask.currentSessionId === sessionId
  ) return 'ask'
  return fallback
}

export function patchSessionScopedSlot(
  state: AgentStore,
  fallbackContext: AgentContext,
  patch: Partial<ContextSlot>,
  sessionId?: string | null,
): Partial<AgentStore> {
  const clientSessionId = resolveClientSessionId(state, sessionId)
  return patchSessionSlot(
    state,
    contextForSession(state, clientSessionId, fallbackContext),
    patch,
    clientSessionId,
  )
}

export function patchActiveContextSlot(
  state: AgentStore,
  context: AgentContext,
  patch: Partial<ContextSlot>,
): Partial<AgentStore> {
  const sessionId = state.activeSessionId[context] || state.slots[context].currentSessionId
  const liveSlot = { ...state.slots[context], ...patch }
  if (!sessionId) return { slots: { ...state.slots, [context]: liveSlot } }

  const cachedSlot = state.sessionSlots[sessionId] || state.slots[context]
  return {
    slots: { ...state.slots, [context]: liveSlot },
    ...cacheSessionSlot(state, sessionId, { ...cachedSlot, ...patch }),
  }
}

export function ensureSessionSlotPatch(
  state: AgentStore,
  sessionId: string,
): Pick<AgentStore, 'sessionSlots' | 'sessionAccessOrder'> {
  const slot = state.sessionSlots[sessionId] || { ...emptySlot(), currentSessionId: sessionId }
  return cacheSessionSlot(state, sessionId, slot)
}

export function removeSessionSlotPatch(
  state: AgentStore,
  sessionId: string,
): Pick<AgentStore, 'sessionSlots' | 'sessionAccessOrder'> {
  const { [sessionId]: _removed, ...sessionSlots } = state.sessionSlots
  return {
    sessionSlots,
    sessionAccessOrder: state.sessionAccessOrder.filter((id) => id !== sessionId),
  }
}

export function buildSessionSwitchPatch(
  state: AgentStore,
  context: AgentContext,
  sessionId: string,
  workspacePath?: string | null,
): Partial<AgentStore> {
  if (!sessionId) {
    const cleanSlot: ContextSlot = {
      ...emptySlot(),
      workspacePath: state.slots[context].workspacePath ||
        (context === 'editor' ? state.activeWorkspacePath : null),
    }
    return {
      activeSessionId: { ...state.activeSessionId, [context]: null },
      ...(context === 'editor' ? { sessionOutputs: null, sessionOutputsLoading: false } : {}),
      sessionLoadError: null,
      slots: { ...state.slots, [context]: cleanSlot },
    }
  }

  let cacheState = state
  const previousSessionId = state.activeSessionId[context]
  if (previousSessionId && previousSessionId !== sessionId) {
    const liveSlot = state.slots[context]
    const savedSlot = state.sessionSlots[previousSessionId]
    if (liveSlot.messages.length > 0 || !savedSlot?.messages.length) {
      const previousPatch = cacheSessionSlot(cacheState, previousSessionId, { ...liveSlot })
      cacheState = { ...cacheState, ...previousPatch }
    }
  }

  const existingSlot = cacheState.sessionSlots[sessionId]
  const targetWorkspacePath = workspacePath ||
    existingSlot?.workspacePath ||
    state.sessionList.find((session) => session.id === sessionId)?.workspacePath ||
    state.sessionList.find((session) => session.sdkSessionId === sessionId)?.workspacePath ||
    state.slots[context].workspacePath ||
    (context === 'editor' ? state.activeWorkspacePath : null)
  const sdkSessionId = getSdkSessionIdForClient(state, sessionId)
  const targetSlot: ContextSlot = existingSlot
    ? {
        ...existingSlot,
        currentSessionId: existingSlot.currentSessionId || sessionId,
        sdkSessionId: existingSlot.sdkSessionId || sdkSessionId,
        workspacePath: targetWorkspacePath,
      }
    : {
        ...emptySlot(),
        currentSessionId: sessionId,
        sdkSessionId,
        workspacePath: targetWorkspacePath,
        _needsSdkLoad: Boolean(sdkSessionId),
      }
  const cachePatch = cacheSessionSlot(cacheState, sessionId, targetSlot, { protectIds: [sessionId] })

  return {
    activeSessionId: { ...state.activeSessionId, [context]: sessionId },
    ...cachePatch,
    ...(context === 'editor' ? { sessionOutputs: null, sessionOutputsLoading: true } : {}),
    sessionLoadError: null,
    slots: { ...state.slots, [context]: targetSlot },
  }
}

function cachedContextSlot(state: AgentStore, context: AgentContext): ContextSlot | null {
  const sessionId = state.slots[context].currentSessionId
  return sessionId ? state.sessionSlots[sessionId] || null : null
}

export function selectPermissionRequest(
  state: AgentStore,
  context: AgentContext,
): PermissionRequestIPC | null {
  return state.slots[context].permissionRequest || cachedContextSlot(state, context)?.permissionRequest || null
}

export function selectPermissionQueueLength(state: AgentStore, context: AgentContext): number {
  const liveLength = state.slots[context].permissionQueue.length
  return liveLength || cachedContextSlot(state, context)?.permissionQueue.length || 0
}

export function selectAskUserRequest(
  state: AgentStore,
  context: AgentContext,
): AskUserRequestIPC | null {
  return state.slots[context].askUserRequest || cachedContextSlot(state, context)?.askUserRequest || null
}

export function selectIsResumingSession(state: AgentStore, context: AgentContext): boolean {
  const slot = state.slots[context]
  return slot._isLoadingMoreMessages && slot.messages.length === 0
}

export function findAskUserTarget(
  state: AgentStore,
  requestId: string,
  fallbackContext: AgentContext,
): AskUserTarget | null {
  for (const context of ['ask', 'editor'] as AgentContext[]) {
    const slot = state.slots[context]
    const request = slot.askUserRequest?.id === requestId
      ? slot.askUserRequest
      : slot.askUserQueue.find((item) => item.id === requestId)
    if (request) {
      return {
        context,
        sessionId: request.sessionId || slot.currentSessionId || state.activeSessionId[context],
      }
    }
  }

  for (const [sessionId, slot] of Object.entries(state.sessionSlots)) {
    const request = slot.askUserRequest?.id === requestId
      ? slot.askUserRequest
      : slot.askUserQueue.find((item) => item.id === requestId)
    if (request) {
      return {
        context: request.context || fallbackContext,
        sessionId: request.sessionId || sessionId,
      }
    }
  }
  return null
}
