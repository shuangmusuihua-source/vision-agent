import type {
  AgentContext,
  ConversationMessage,
  SessionRoutedAskUserRequest,
  SessionRoutedPermissionRequest,
} from '../../shared/types'
import type { AgentStore, ContextSlot } from './agent-store'
import { emptySlot } from './agent-store'

const MAX_SESSION_SLOTS = 30

type CacheOptions = {
  removeIds?: string[]
  protectIds?: Array<string | null | undefined>
}

export type SessionInteractionTarget = {
  context: AgentContext
  sessionId: string | null
}

export type SessionInteractionMutation = {
  patch: Partial<AgentStore>
  target: SessionInteractionTarget | null
}

type PendingInteractionKind = 'permission' | 'askUser'
type PendingInteraction =
  | { kind: 'permission'; request: SessionRoutedPermissionRequest }
  | { kind: 'askUser'; request: SessionRoutedAskUserRequest }
type PendingInteractionRequest =
  | SessionRoutedPermissionRequest
  | SessionRoutedAskUserRequest

type PendingInteractionLocation = {
  context: AgentContext
  sessionId: string | null
  slot: ContextSlot
  queueIndex: number | null
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
): SessionRoutedPermissionRequest | null {
  return state.slots[context].permissionRequest || cachedContextSlot(state, context)?.permissionRequest || null
}

export function selectPermissionQueueLength(state: AgentStore, context: AgentContext): number {
  const liveLength = state.slots[context].permissionQueue.length
  return liveLength || cachedContextSlot(state, context)?.permissionQueue.length || 0
}

export function selectAskUserRequest(
  state: AgentStore,
  context: AgentContext,
): SessionRoutedAskUserRequest | null {
  return state.slots[context].askUserRequest || cachedContextSlot(state, context)?.askUserRequest || null
}

export function selectIsResumingSession(state: AgentStore, context: AgentContext): boolean {
  const slot = state.slots[context]
  return slot._isLoadingMoreMessages && slot.messages.length === 0
}

function currentInteraction(
  slot: ContextSlot,
  kind: PendingInteractionKind,
): PendingInteractionRequest | null {
  return kind === 'permission' ? slot.permissionRequest : slot.askUserRequest
}

function interactionQueue(
  slot: ContextSlot,
  kind: PendingInteractionKind,
): PendingInteractionRequest[] {
  return kind === 'permission' ? slot.permissionQueue : slot.askUserQueue
}

function interactionPatch(
  slot: ContextSlot,
  kind: PendingInteractionKind,
  queueIndex: number | null,
): Partial<ContextSlot> {
  if (kind === 'permission') {
    if (queueIndex === null) {
      return {
        permissionRequest: slot.permissionQueue[0] ?? null,
        permissionQueue: slot.permissionQueue.slice(1),
      }
    }
    return {
      permissionQueue: slot.permissionQueue.filter((_, index) => index !== queueIndex),
    }
  }

  if (queueIndex === null) {
    return {
      askUserRequest: slot.askUserQueue[0] ?? null,
      askUserQueue: slot.askUserQueue.slice(1),
    }
  }
  return {
    askUserQueue: slot.askUserQueue.filter((_, index) => index !== queueIndex),
  }
}

function findInteractionLocation(
  state: AgentStore,
  kind: PendingInteractionKind,
  requestId: string,
): PendingInteractionLocation | null {
  const contexts: AgentContext[] = ['editor', 'ask']

  for (const context of contexts) {
    const slot = state.slots[context]
    const current = currentInteraction(slot, kind)
    if (current?.id === requestId) {
      return {
        context: current.context,
        sessionId: resolveClientSessionId(state, current.clientSessionKey),
        slot,
        queueIndex: null,
      }
    }

    const queue = interactionQueue(slot, kind)
    const queueIndex = queue.findIndex((item) => item.id === requestId)
    if (queueIndex !== -1) {
      const request = queue[queueIndex]
      return {
        context: request.context,
        sessionId: resolveClientSessionId(state, request.clientSessionKey),
        slot,
        queueIndex,
      }
    }
  }

  for (const slot of Object.values(state.sessionSlots)) {
    const current = currentInteraction(slot, kind)
    if (current?.id === requestId) {
      return {
        context: current.context,
        sessionId: resolveClientSessionId(state, current.clientSessionKey),
        slot,
        queueIndex: null,
      }
    }

    const queue = interactionQueue(slot, kind)
    const queueIndex = queue.findIndex((item) => item.id === requestId)
    if (queueIndex !== -1) {
      const request = queue[queueIndex]
      return {
        context: request.context,
        sessionId: resolveClientSessionId(state, request.clientSessionKey),
        slot,
        queueIndex,
      }
    }
  }
  return null
}

function enqueueInteraction(
  state: AgentStore,
  interaction: PendingInteraction,
): SessionInteractionMutation {
  const { request } = interaction
  const context = request.context
  const sessionId = resolveClientSessionId(state, request.clientSessionKey)
  const liveSlot = state.slots[context]
  const liveSessionId = liveSlot.currentSessionId
  const activeSessionId = state.activeSessionId[context]
  const belongsToLiveSession = Boolean(
    sessionId && (sessionId === liveSessionId || sessionId === activeSessionId),
  )
  const belongsToBackgroundSession = Boolean(sessionId && !belongsToLiveSession)

  if (belongsToBackgroundSession) {
    if (!sessionId) return { patch: {}, target: null }
    const backgroundSlot = state.sessionSlots[sessionId]
      || { ...emptySlot(), currentSessionId: sessionId }
    const patch = interaction.kind === 'permission'
      ? backgroundSlot.permissionRequest
        ? {
            currentSessionId: backgroundSlot.currentSessionId || sessionId,
            permissionQueue: [...backgroundSlot.permissionQueue, interaction.request],
          }
        : {
            currentSessionId: backgroundSlot.currentSessionId || sessionId,
            permissionRequest: interaction.request,
          }
      : backgroundSlot.askUserRequest
        ? {
            currentSessionId: backgroundSlot.currentSessionId || sessionId,
            askUserQueue: [...backgroundSlot.askUserQueue, interaction.request],
          }
        : {
            currentSessionId: backgroundSlot.currentSessionId || sessionId,
            askUserRequest: interaction.request,
          }
    return {
      patch: patchSessionSlot(state, context, patch, sessionId),
      target: { context, sessionId },
    }
  }

  const patch = interaction.kind === 'permission'
    ? liveSlot.permissionRequest
      ? { permissionQueue: [...liveSlot.permissionQueue, interaction.request] }
      : { permissionRequest: interaction.request }
    : liveSlot.askUserRequest
      ? { askUserQueue: [...liveSlot.askUserQueue, interaction.request] }
      : { askUserRequest: interaction.request }
  return {
    patch: patchSessionSlot(state, context, patch),
    target: { context, sessionId },
  }
}

function resolveInteraction(
  state: AgentStore,
  kind: PendingInteractionKind,
  requestId: string,
  message?: ConversationMessage,
): SessionInteractionMutation {
  const location = findInteractionLocation(state, kind, requestId)
  if (!location) return { patch: {}, target: null }

  const slotPatch = interactionPatch(
    location.slot,
    kind,
    location.queueIndex,
  )
  if (message) slotPatch.messages = [...location.slot.messages, message]

  return {
    patch: patchSessionScopedSlot(
      state,
      location.context,
      slotPatch,
      location.sessionId,
    ),
    target: {
      context: location.context,
      sessionId: location.sessionId,
    },
  }
}

export function enqueuePermissionInteraction(
  state: AgentStore,
  request: SessionRoutedPermissionRequest,
): SessionInteractionMutation {
  return enqueueInteraction(state, { kind: 'permission', request })
}

export function enqueueAskUserInteraction(
  state: AgentStore,
  request: SessionRoutedAskUserRequest,
): SessionInteractionMutation {
  return enqueueInteraction(state, { kind: 'askUser', request })
}

export function resolvePermissionInteraction(
  state: AgentStore,
  requestId: string,
): SessionInteractionMutation {
  return resolveInteraction(state, 'permission', requestId)
}

export function resolveAskUserInteraction(
  state: AgentStore,
  requestId: string,
  message?: ConversationMessage,
): SessionInteractionMutation {
  return resolveInteraction(state, 'askUser', requestId, message)
}
