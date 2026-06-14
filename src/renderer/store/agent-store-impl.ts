import { create } from 'zustand'
import type { AgentStore, ContextSlot } from './agent-store'
import { emptySlot } from './agent-store'
import { sessionListReducer, type SessionListAction } from './session-protocol'
import type {
  AgentContext,
  AgentIPCMessage,
  AgentState,
  AgentEvent,
  ConversationMessage,
  TextMessage,
  ContentBlock,
  ToolCallState,
  PermissionRequestIPC,
  AskUserRequestIPC,
  SkillOutputState,
  AssistantPayload,
  UserPayload,
  ResultErrorPayload,
  StreamEventPayloadIPC,
} from '../../shared/types'
import { AGENT_TRANSITIONS as TRANSITIONS } from '../../shared/types'
import {
  extractArtifactFromMessage,
  buildReplayedMessages,
  reduceSystemMessage,
  reduceAssistantMessage,
  reduceStreamEvent,
  reduceUserMessage,
  reduceResultMessage,
} from './message-pipeline'

// ─── Slot helpers ────────────────────────────────────────────────────────

const MAX_SESSION_SLOTS = 30

/**
 * Resolve the correct source slot for a reducer call.
 * When eventSid is set and the event belongs to an inactive
 * session (i.e. the session is cached in sessionSlots but is not the active
 * one), we must read from sessionSlots[sid] — NOT from slots[ctx] which
 * now belongs to the active session.  Reading from slots[ctx] would cause
 * the reducer to operate on the wrong session's state, corrupting the
 * cached slot when the patch is written back via updateSlot.
 */
function resolveSlot(state: AgentStore, ctx: AgentContext, eventSid?: string | null): ContextSlot {
  const sid = eventSid || null
  const slotSid = state.slots[ctx]?.currentSessionId
  // Use live slot when: no sessionId on event, event matches this context's
  // active session, or event matches slot's session.
  if (!sid || sid === state.activeSessionId[ctx] || sid === slotSid) {
    return state.slots[ctx]
  }
  // Event is for a different (background) session → use its cached slot
  if (state.sessionSlots[sid]) {
    return state.sessionSlots[sid]
  }
  // If no session is confirmed for this context yet (sessionCreated hasn't
  // fired), fall back to the live slot for brand-new sessions.
  if (!slotSid) {
    return state.slots[ctx]
  }
  return state.slots[ctx]
}

function updateSlot(
  state: AgentStore,
  ctx: AgentContext,
  patch: Partial<ContextSlot>,
  eventSid?: string | null
): Partial<AgentStore> {
  const sid = eventSid || null
  if (sid) {
    // Defensive: auto-create session slot if missing (handles race where
    // stream_event arrives before sessionCreated creates the slot)
    let cached = state.sessionSlots[sid]
    if (!cached) {
      cached = emptySlot()
    }
    // Update access order: move sid to the end (most recently accessed)
    const accessOrder = state.sessionAccessOrder.filter((id) => id !== sid)
    accessOrder.push(sid)

    // LRU eviction: if over limit, evict oldest entries that are not active
    let newSessionSlots = {
      ...state.sessionSlots,
      [sid]: { ...cached, ...patch },
    }

    if (accessOrder.length > MAX_SESSION_SLOTS) {
      // Determine protected session IDs — never evict the active session
      // or the sessions currently bound to editor/ask contexts
      const protectedIds = new Set<string>()
      if (state.activeSessionId.editor) protectedIds.add(state.activeSessionId.editor)
      if (state.activeSessionId.ask) protectedIds.add(state.activeSessionId.ask)
      const editorSid = state.slots.editor.currentSessionId
      const askSid = state.slots.ask.currentSessionId
      if (editorSid) protectedIds.add(editorSid)
      if (askSid) protectedIds.add(askSid)

      const evictCount = accessOrder.length - MAX_SESSION_SLOTS
      let evicted = 0
      const remainingOrder: string[] = []
      for (const candidateId of accessOrder) {
        if (evicted < evictCount && !protectedIds.has(candidateId)) {
          delete (newSessionSlots as Record<string, unknown>)[candidateId]
          evicted++
        } else {
          remainingOrder.push(candidateId)
        }
      }
      if (evicted > 0) {
        console.info(
          `[AgentStore] LRU evicted ${evicted} session slot(s) ` +
          `(limit: ${MAX_SESSION_SLOTS})`
        )
        return {
          sessionSlots: newSessionSlots,
          sessionAccessOrder: remainingOrder,
          ...(sid === state.activeSessionId[ctx]
            ? { slots: { ...state.slots, [ctx]: { ...state.slots[ctx], ...patch } } }
            : {}),
        }
      }
    }

    const result: Partial<AgentStore> = {
      sessionSlots: newSessionSlots,
      sessionAccessOrder: accessOrder,
    }
    if (sid === state.activeSessionId[ctx]) {
      result.slots = { ...state.slots, [ctx]: { ...state.slots[ctx], ...patch } }
    }
    return result
  }
  return {
    slots: {
      ...state.slots,
      [ctx]: { ...state.slots[ctx], ...patch },
    },
  }
}

function normalizeSessionId(sessionId?: string | null): string | null {
  if (!sessionId || sessionId === 'editor' || sessionId === 'ask') return null
  return sessionId
}

function resolveClientSessionId(state: AgentStore, sessionId?: string | null): string | null {
  const sid = normalizeSessionId(sessionId)
  if (!sid) return null
  if (
    state.sessionSlots[sid] ||
    state.activeSessionId.editor === sid ||
    state.activeSessionId.ask === sid ||
    state.slots.editor.currentSessionId === sid ||
    state.slots.ask.currentSessionId === sid
  ) {
    return sid
  }

  for (const [clientId, slot] of Object.entries(state.sessionSlots)) {
    if (slot.sdkSessionId === sid) return clientId
  }

  const listed = state.sessionList.find((session) => session.sdkSessionId === sid)
  return listed?.id || sid
}

function getSdkSessionIdForClient(state: AgentStore, sessionId: string | null): string | null {
  const sid = normalizeSessionId(sessionId)
  if (!sid) return null
  const slot = state.sessionSlots[sid]
  if (slot?.sdkSessionId) return slot.sdkSessionId
  const activeContext: AgentContext | null =
    state.activeSessionId.editor === sid ? 'editor' :
    state.activeSessionId.ask === sid ? 'ask' :
    null
  if (activeContext && state.slots[activeContext].sdkSessionId) {
    return state.slots[activeContext].sdkSessionId
  }
  const listed = state.sessionList.find((session) => session.id === sid)
  if (listed?.sdkSessionId) return listed.sdkSessionId
  return sid.startsWith('new-') ? null : sid
}

function contextForSession(
  state: AgentStore,
  sessionId: string | null,
  fallback: AgentContext
): AgentContext {
  if (!sessionId) return fallback
  if (state.activeSessionId.editor === sessionId || state.slots.editor.currentSessionId === sessionId) return 'editor'
  if (state.activeSessionId.ask === sessionId || state.slots.ask.currentSessionId === sessionId) return 'ask'
  return fallback
}

function updateSessionScopedSlot(
  state: AgentStore,
  fallbackContext: AgentContext,
  patch: Partial<ContextSlot>,
  sessionId?: string | null
): Partial<AgentStore> {
  const sid = resolveClientSessionId(state, sessionId)
  return updateSlot(state, contextForSession(state, sid, fallbackContext), patch, sid)
}

function mergeLoadedMessages(
  loadedMessages: ConversationMessage[],
  currentMessages: ConversationMessage[]
): ConversationMessage[] {
  const seen = new Set<string>()
  const merged: ConversationMessage[] = []
  for (const message of [...loadedMessages, ...currentMessages]) {
    if (seen.has(message.id)) continue
    seen.add(message.id)
    merged.push(message)
  }
  return merged
}

// ─── State Machine ─────────────────────────────────────────────────────

export function transition(current: AgentState, event: AgentEvent): AgentState {
  const allowed = TRANSITIONS[current]?.[event.type]
  if (!allowed) {
    console.warn(`[AgentFSM] Invalid transition: ${current} + ${event.type}`)
    return current
  }
  return allowed
}

// ─── Re-exports from pipeline (backward-compatible) ─────────────────────

export { ensureAccumulator, commitAccumulator, extractSkillOutputContent } from './message-pipeline'

// ─── Store ─────────────────────────────────────────────────────────────

type StoreApi = {
  set: (partial: Partial<AgentStore> | ((state: AgentStore) => Partial<AgentStore>)) => void
  get: () => AgentStore
}

export const useAgentStore = create<AgentStore>((set, get) => {
  const store: StoreApi = { set, get }

  function dispatchEffectEvents(eventSid: string | null, events: AgentEvent[], ctx: AgentContext) {
    for (const event of events) {
      get().dispatchAgentEvent(event, ctx, eventSid)
    }
  }

  return {
    context: 'editor',
    slots: { editor: emptySlot(), ask: emptySlot() },
    isResumingSession: false,
    sessionList: [],
    sessionSlots: {},
    sessionAccessOrder: [],
    activeWorkspacePath: null,
    workspaceDigest: null,
    workspaceDigestLoading: false,
    activeSessionId: { editor: null, ask: null },
    sessionOutputs: null,
    sessionOutputsLoading: false,

    // ─── State Machine ──────────────────────────────────────────────────

    dispatchAgentEvent(event: AgentEvent, eventContext?: AgentContext, eventSid?: string | null) {
      const ctx = eventContext || get().context
      set((state) => {
        // Use resolveSlot to get the correct slot — it handles the case
        // where sessionSlots has an auto-created stale entry that would
        // shadow the live slot before sessionCreated fires.
        const slot = resolveSlot(state, ctx, eventSid)
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
            (m) => !(m.kind === 'status' && m.phase === 'streaming')
          )
        }

        if (event.type === 'RESULT_SUCCESS') {
          slotUpdates.isStreaming = false
          slotUpdates._acc = null
          slotUpdates._firstContentSeen = false
          slotUpdates.activeSkillId = null
          slotUpdates.skillOutput = null
          slotUpdates.todoList = null
          slotUpdates.permissionRequest = null
          slotUpdates.permissionQueue = []
          slotUpdates.askUserRequest = null
          slotUpdates.askUserQueue = []
          const msgs = (slotUpdates.messages || slot.messages).map((m) =>
            m.kind === 'text' && m.phase !== 'complete' && m.phase !== 'error'
              ? { ...m, phase: 'complete' as const }
              : m
          )
          const skillId = slot.activeSkillId
          if (skillId) {
            for (let i = 0; i < msgs.length; i++) {
              const msg = msgs[i]
              if ((msg.kind === 'text' || msg.kind === 'user') && msg.skillMeta?.id === skillId) {
                msgs[i] = { ...msg, skillMeta: { ...msg.skillMeta!, status: 'completed' } } as typeof msg
                break
              }
            }
          }
          const finalMsgs = [...msgs]
          const processedIds = slot._processedArtifactIds
          for (let i = msgs.length - 1; i >= 0; i--) {
            if (processedIds.has(msgs[i].id)) continue
            const artifact = extractArtifactFromMessage(msgs[i])
            if (artifact) {
              processedIds.add(msgs[i].id)
              finalMsgs.push({ kind: 'artifact' as const, id: `artifact-${Date.now()}-${i}`, role: 'assistant', artifact, createdAt: Date.now() })
            }
          }
          slotUpdates._processedArtifactIds = processedIds
          slotUpdates.messages = finalMsgs
        }

        if (event.type === 'RESULT_ERROR') {
          slotUpdates.isStreaming = false
          slotUpdates._acc = null
          slotUpdates._firstContentSeen = false
          slotUpdates.activeSkillId = null
          slotUpdates.skillOutput = null
          slotUpdates.todoList = null
          slotUpdates.permissionRequest = null
          slotUpdates.permissionQueue = []
          slotUpdates.askUserRequest = null
          slotUpdates.askUserQueue = []
          const msgs = (slotUpdates.messages || slot.messages).map((m) =>
            m.kind === 'text' && m.phase !== 'complete' && m.phase !== 'stopped'
              ? { ...m, phase: 'error' as const }
              : m
          )
          const skillId = slot.activeSkillId
          if (skillId) {
            for (let i = 0; i < msgs.length; i++) {
              const msg = msgs[i]
              if ((msg.kind === 'text' || msg.kind === 'user') && msg.skillMeta?.id === skillId) {
                msgs[i] = { ...msg, skillMeta: { ...msg.skillMeta!, status: 'error' } } as typeof msg
                break
              }
            }
          }
          slotUpdates.messages = msgs
        }

        if (event.type === 'ABORT') {
          slotUpdates.isStreaming = false
          slotUpdates._acc = null
          slotUpdates._firstContentSeen = false
          slotUpdates.activeSkillId = null
          slotUpdates.skillOutput = null
          slotUpdates.todoList = null
          slotUpdates.permissionRequest = null
          slotUpdates.permissionQueue = []
          slotUpdates.askUserRequest = null
          slotUpdates.askUserQueue = []
          const msgs = (slotUpdates.messages || slot.messages).map((m) =>
            m.kind === 'text' && m.phase !== 'complete' && m.phase !== 'error'
              ? { ...m, phase: 'complete' as const }
              : m
          )
          slotUpdates.messages = msgs
        }

        return updateSlot(state, ctx, slotUpdates, eventSid)
      })
    },

    // ─── Core Reducer ───────────────────────────────────────────────────

    processIPCMessage(msg: AgentIPCMessage & { context?: AgentContext; sessionId?: string; clientSessionKey?: string; sdkSessionId?: string }, options?: { isReplay?: boolean }) {
      const isReplay = options?.isReplay ?? false
      const ctx = msg.context || get().context
      const rawEventSessionId = ((msg as Record<string, unknown>).clientSessionKey as string)
        || ((msg as Record<string, unknown>).sessionId as string)
        || ((msg as Record<string, unknown>).session_id as string)
        || undefined
      const eventSessionId = resolveClientSessionId(get(), rawEventSessionId) || undefined

      // Replay restores message content, but must not drive the live FSM.
      if (isReplay) {
        if (msg.type === 'stream_event') return

        switch (msg.type) {
          case 'system': {
            const sourceSlot = resolveSlot(get(), ctx, eventSessionId)
            const { patch } = reduceSystemMessage(
              sourceSlot, msg as unknown as AgentIPCMessage & { subtype?: string; session_id?: string; message?: string; tool_use_id?: string }
            )
            if (Object.keys(patch).length > 0) {
              set((state) => updateSlot(state, ctx, patch, eventSessionId))
            }
            break
          }
          case 'assistant': {
            const sourceSlot = resolveSlot(get(), ctx, eventSessionId)
            const { patch } = reduceAssistantMessage(sourceSlot, msg as AssistantPayload)
            set((state) => updateSlot(state, ctx, patch, eventSessionId))
            break
          }
          case 'user': {
            const sourceSlot = resolveSlot(get(), ctx, eventSessionId)
            const patch = reduceUserMessage(sourceSlot, msg as UserPayload, isReplay)
            if (patch) set((state) => updateSlot(state, ctx, patch, eventSessionId))
            break
          }
          case 'result': {
            const sourceSlot = resolveSlot(get(), ctx, eventSessionId)
            const { patch } = reduceResultMessage(
              sourceSlot,
              msg as AgentIPCMessage & { subtype?: string },
              sourceSlot._resultGuardGen
            )
            if (patch) set((state) => updateSlot(state, ctx, patch, eventSessionId))
            break
          }
        }
        return
      }

      // Live dispatch: read slot inside set() for freshness
      switch (msg.type) {
          case 'system': {
            set((state) => {
              const sourceSlot = resolveSlot(state, ctx, eventSessionId)
              const { patch, events } = reduceSystemMessage(
                sourceSlot, msg as unknown as AgentIPCMessage & { subtype?: string; session_id?: string; message?: string; tool_use_id?: string }
              )
              if (Object.keys(patch).length === 0 && events.length === 0) return {}
              // Dispatch events after state update (sync — Zustand batches)
              if (events.length > 0) {
                setTimeout(() => dispatchEffectEvents(eventSessionId || null, events, ctx), 0)
              }
              return Object.keys(patch).length > 0 ? updateSlot(state, ctx, patch, eventSessionId) : {}
            })
            break
          }
          case 'assistant': {
            set((state) => {
              const sourceSlot = resolveSlot(state, ctx, eventSessionId)
              const { patch, events } = reduceAssistantMessage(sourceSlot, msg as AssistantPayload)
              if (events.length > 0) {
                setTimeout(() => dispatchEffectEvents(eventSessionId || null, events, ctx), 0)
              }
              return updateSlot(state, ctx, patch, eventSessionId)
            })
            break
          }
          case 'stream_event': {
            const streamMsg = msg as StreamEventPayloadIPC
            set((state) => {
              const sourceSlot = resolveSlot(state, ctx, eventSessionId)
              if (!sourceSlot) return {}
              const result = reduceStreamEvent(sourceSlot, streamMsg)
              if (!result.patch) {
                return {}
              }
              // Handle deferred FIRST_CONTENT event
              if (result.firstContentSeenDuringThisCall) {
                setTimeout(() => {
                  const currentState = resolveSlot(get(), ctx, eventSessionId).agentState
                  if (currentState === 'thinking' || currentState === 'compacting') {
                    dispatchEffectEvents(eventSessionId || null, [{ type: 'FIRST_CONTENT' }], ctx)
                  }
                }, 0)
              }
              return updateSlot(state, ctx, result.patch, eventSessionId)
            })
            break
          }
          case 'user': {
            set((state) => {
              const sourceSlot = resolveSlot(state, ctx, eventSessionId)
              const patch = reduceUserMessage(sourceSlot, msg as UserPayload, isReplay)
              return patch ? updateSlot(state, ctx, patch, eventSessionId) : {}
            })
            break
          }
          case 'result': {
            set((state) => {
              const sourceSlot = resolveSlot(state, ctx, eventSessionId)
              const abortGuardGen = sourceSlot._resultGuardGen
              const { patch, events } = reduceResultMessage(
                sourceSlot,
                msg as AgentIPCMessage & { subtype?: string },
                abortGuardGen
              )
              if (events.length > 0) {
                setTimeout(() => dispatchEffectEvents(eventSessionId || null, events, ctx), 0)
              }
              return patch ? updateSlot(state, ctx, patch, eventSessionId) : {}
            })
            break
          }
          case 'rate_limit_event': {
            // Rate limit events are informational; no state change needed for now
            break
          }
          case 'prompt_suggestion': {
            // Prompt suggestions are informational; no state change needed for now
            break
          }
      }
    },

    // ─── Interaction Handlers ─────────────────────────────────────────────

    handlePermissionRequest(req: PermissionRequestIPC) {
      // Use the context slot's own sessionId, not global activeSessionId.
      // activeSessionId tracks the editor's UI-state session; the ask context
      // operates independently and must not be gatekept by editor state.
      const ctx = (req.context as AgentContext) || get().context
      const reqSessionId = resolveClientSessionId(get(), req.clientSessionKey || req.sessionId)
      const slotSid = get().slots[ctx]?.currentSessionId
      const activeSid = get().activeSessionId[ctx]
      const belongsToLiveSession = !!(reqSessionId && (reqSessionId === slotSid || reqSessionId === activeSid))
      const isOtherSession = !!(reqSessionId && !belongsToLiveSession)
      const isNewSessionGuard = !!(!req.sessionId && slotSid && !slotSid.startsWith('new-'))
      if (isOtherSession || isNewSessionGuard) {
        // The request belongs to a background session — don't show the dialog,
        // but DO persist into sessionSlots so it appears when the user switches.
        if (reqSessionId) {
          set((state) => {
            const sid = reqSessionId
            const isNew = !state.sessionSlots[sid]
            const bgSlot = isNew ? { ...emptySlot(), currentSessionId: sid } : state.sessionSlots[sid]
            const patch = bgSlot.permissionRequest
              ? { permissionQueue: [...bgSlot.permissionQueue, req] }
              : { permissionRequest: req }
            const accessOrder = state.sessionAccessOrder.filter((id) => id !== sid)
            accessOrder.push(sid)
            return {
              sessionSlots: { ...state.sessionSlots, [sid]: { ...bgSlot, ...patch } },
              sessionAccessOrder: accessOrder,
            }
          })
        }
        return
      }

      set((state) => {
        const slot = state.slots[ctx]
        if (slot.permissionRequest) {
          return updateSlot(state, ctx, { permissionQueue: [...slot.permissionQueue, req] })
        }
        return updateSlot(state, ctx, { permissionRequest: req })
      })

    },

    // ─── Permission / AskUser response & timeout handlers ──────────────────
    // These search BOTH the active slots and sessionSlots, because a
    // permission or AskUser request belongs to a specific session and may
    // be resident in either location depending on timing.

    handlePermissionResponse(requestId: string, behavior: 'allow' | 'deny') {
      set((state) => {
        // 1) Search active slots
        for (const ctx of ['editor', 'ask'] as AgentContext[]) {
          const slot = state.slots[ctx]
          if (slot.permissionRequest?.id === requestId) {
            const permRespSid = slot.permissionRequest.sessionId || null
            const next = slot.permissionQueue[0] ?? null
            const rest = slot.permissionQueue.slice(1)
            return updateSessionScopedSlot(state, ctx, { permissionRequest: next, permissionQueue: rest }, permRespSid)
          }
          const qIdx = slot.permissionQueue.findIndex((r) => r.id === requestId)
          if (qIdx !== -1) {
            const queuedSid = slot.permissionQueue[qIdx].sessionId || null
            const filtered = [...slot.permissionQueue]
            filtered.splice(qIdx, 1)
            return updateSessionScopedSlot(state, ctx, { permissionQueue: filtered }, queuedSid)
          }
        }
        // 2) Search sessionSlots for sessions that are not currently active
        for (const [sid, slot] of Object.entries(state.sessionSlots)) {
          if (slot.permissionRequest?.id === requestId) {
            const next = slot.permissionQueue[0] ?? null
            const rest = slot.permissionQueue.slice(1)
            return updateSessionScopedSlot(state, slot.permissionRequest.context || 'editor', { permissionRequest: next, permissionQueue: rest }, sid)
          }
          const qIdx = slot.permissionQueue.findIndex((r) => r.id === requestId)
          if (qIdx !== -1) {
            const filtered = [...slot.permissionQueue]
            const queuedSid = filtered[qIdx].sessionId || sid
            const queuedContext = filtered[qIdx].context || 'editor'
            filtered.splice(qIdx, 1)
            return updateSessionScopedSlot(state, queuedContext, { permissionQueue: filtered }, queuedSid)
          }
        }
        return {}
      })
    },

    handleAskUserRequest(req: AskUserRequestIPC) {
      // Use the context slot's own sessionId, not global activeSessionId.
      const ctx = (req.context as AgentContext) || get().context
      const reqSessionId = resolveClientSessionId(get(), req.clientSessionKey || req.sessionId)
      const slotSid = get().slots[ctx]?.currentSessionId
      const activeSid = get().activeSessionId[ctx]
      const belongsToLiveSession = !!(reqSessionId && (reqSessionId === slotSid || reqSessionId === activeSid))
      const isOtherSession = !!(reqSessionId && !belongsToLiveSession)
      const isNewSessionGuard = !!(!req.sessionId && slotSid && !slotSid.startsWith('new-'))
      if (isOtherSession || isNewSessionGuard) {
        // Background session — persist into sessionSlots so the dialog
        // appears naturally when the user switches to this session.
        if (reqSessionId) {
          set((state) => {
            const sid = reqSessionId
            const isNew = !state.sessionSlots[sid]
            const bgSlot = isNew ? { ...emptySlot(), currentSessionId: sid } : state.sessionSlots[sid]
            const patch = bgSlot.askUserRequest
              ? { askUserQueue: [...bgSlot.askUserQueue, req] }
              : { askUserRequest: req }
            const accessOrder = state.sessionAccessOrder.filter((id) => id !== sid)
            accessOrder.push(sid)
            return {
              sessionSlots: { ...state.sessionSlots, [sid]: { ...bgSlot, ...patch } },
              sessionAccessOrder: accessOrder,
            }
          })
          get().dispatchAgentEvent({ type: 'ASK_USER_REQUEST' }, ctx, reqSessionId)
        }
        return
      }

      set((state) => {
        const slot = state.slots[ctx]
        if (slot.askUserRequest) {
          return updateSlot(state, ctx, { askUserQueue: [...slot.askUserQueue, req] })
        }
        return updateSlot(state, ctx, { askUserRequest: req })
      })
      get().dispatchAgentEvent({ type: 'ASK_USER_REQUEST' }, ctx, reqSessionId)

    },

    handleAskUserResponse(requestId: string, answers: Record<string, string>) {
      const displayAnswer = Object.values(answers).filter(Boolean).join('；') || Object.keys(answers).join(', ')
      set((state) => {
        // 1) Search active slots
        let ctx: AgentContext = state.context
        if (state.slots.ask.askUserRequest?.id === requestId) ctx = 'ask'
        else if (state.slots.editor.askUserRequest?.id === requestId) ctx = 'editor'
        else {
          // 2) Search sessionSlots
          for (const [sid, slot] of Object.entries(state.sessionSlots)) {
            if (slot.askUserRequest?.id === requestId) {
              const next = slot.askUserQueue[0] ?? null
              const rest = slot.askUserQueue.slice(1)
              return updateSessionScopedSlot(state, slot.askUserRequest.context || 'editor', {
                messages: [...slot.messages, { kind: 'user' as const, id: `user-answer-${Date.now()}`, role: 'user', textContent: displayAnswer, createdAt: Date.now() }],
                askUserRequest: next, askUserQueue: rest,
              }, sid)
            }
          }
          return {}
        }

        const s = state.slots[ctx]
        const askRespSid = s.askUserRequest?.sessionId || null
        const next = s.askUserQueue[0] ?? null
        const rest = s.askUserQueue.slice(1)
        return updateSessionScopedSlot(state, ctx, {
          messages: [...s.messages, { kind: 'user' as const, id: `user-answer-${Date.now()}`, role: 'user', textContent: displayAnswer, createdAt: Date.now() }],
          askUserRequest: next, askUserQueue: rest,
        }, askRespSid)
      })
    },

    handleAskUserTimeout(requestId: string) {
      let timeoutEventContext: AgentContext | null = null
      let timeoutEventSessionId: string | null = null
      set((state) => {
        // 1) Search active slots
        let ctx: AgentContext = state.context
        if (state.slots.ask.askUserRequest?.id === requestId) ctx = 'ask'
        else if (state.slots.editor.askUserRequest?.id === requestId) ctx = 'editor'
        else {
          // 2) Search sessionSlots
          for (const [sid, slot] of Object.entries(state.sessionSlots)) {
            if (slot.askUserRequest?.id === requestId) {
              const next = slot.askUserQueue[0] ?? null
              const rest = slot.askUserQueue.slice(1)
              const requestContext = slot.askUserRequest.context || 'editor'
              const updated = updateSessionScopedSlot(state, requestContext, {
                messages: [...slot.messages, { kind: 'status' as const, id: `timeout-${Date.now()}`, role: 'system', phase: 'complete', textContent: '☕ 等了很久没有回应，我先休息一下，有事随时沟通', createdAt: Date.now() }],
                askUserRequest: next, askUserQueue: rest,
              }, sid)
              timeoutEventContext = requestContext
              timeoutEventSessionId = sid
              return updated
            }
          }
          return {}
        }

        const s = state.slots[ctx]
        const askTimeoutSid = s.askUserRequest?.sessionId || null
        const next = s.askUserQueue[0] ?? null
        const rest = s.askUserQueue.slice(1)
        const updated = updateSessionScopedSlot(state, ctx, {
          messages: [...s.messages, { kind: 'status' as const, id: `timeout-${Date.now()}`, role: 'system', phase: 'complete', textContent: '☕ 等了很久没有回应，我先休息一下，有事随时沟通', createdAt: Date.now() }],
          askUserRequest: next, askUserQueue: rest,
        }, askTimeoutSid)
        timeoutEventContext = ctx
        timeoutEventSessionId = askTimeoutSid
        return updated
      })
      if (timeoutEventContext) {
        get().dispatchAgentEvent({ type: 'ASK_USER_TIMEOUT' }, timeoutEventContext, timeoutEventSessionId)
      }
    },

    handlePermissionTimeout(requestId: string) {
      set((state) => {
        // 1) Search active slots
        for (const ctx of ['editor', 'ask'] as AgentContext[]) {
          const slot = state.slots[ctx]
          if (slot.permissionRequest?.id === requestId) {
            const permTOSid = slot.permissionRequest.sessionId || null
            const next = slot.permissionQueue[0] ?? null
            const rest = slot.permissionQueue.slice(1)
            return updateSessionScopedSlot(state, ctx, { permissionRequest: next, permissionQueue: rest }, permTOSid)
          }
          const qIdx = slot.permissionQueue.findIndex((r) => r.id === requestId)
          if (qIdx !== -1) {
            const queuedSid = slot.permissionQueue[qIdx].sessionId || null
            const filtered = [...slot.permissionQueue]
            filtered.splice(qIdx, 1)
            return updateSessionScopedSlot(state, ctx, { permissionQueue: filtered }, queuedSid)
          }
        }
        // 2) Search sessionSlots
        for (const [sid, slot] of Object.entries(state.sessionSlots)) {
          if (slot.permissionRequest?.id === requestId) {
            const next = slot.permissionQueue[0] ?? null
            const rest = slot.permissionQueue.slice(1)
            return updateSessionScopedSlot(state, slot.permissionRequest.context || 'editor', { permissionRequest: next, permissionQueue: rest }, sid)
          }
          const qIdx = slot.permissionQueue.findIndex((r) => r.id === requestId)
          if (qIdx !== -1) {
            const filtered = [...slot.permissionQueue]
            const queuedSid = filtered[qIdx].sessionId || sid
            const queuedContext = filtered[qIdx].context || 'editor'
            filtered.splice(qIdx, 1)
            return updateSessionScopedSlot(state, queuedContext, { permissionQueue: filtered }, queuedSid)
          }
        }
        return {}
      })
    },

    handleSkillOutput(skillState: SkillOutputState) {
      const skillSid = skillState.sessionId || null
      const ctx = skillState.context || get().context
      set((s) => updateSessionScopedSlot(s, ctx, { skillOutput: skillState }, skillSid))
    },

    setPrefill(context: AgentContext, text: string) {
      set((s) => updateSlot(s, context, { prefillText: text }))
    },

    consumePrefill(context: AgentContext) {
      set((s) => updateSlot(s, context, { prefillText: null }))
    },

    // ─── Workspace Actions ────────────────────────────────────────────────

    setActiveWorkspace(path: string | null) {
      set((s) => {
        const base: Partial<AgentStore> = { activeWorkspacePath: path }
        if (path) {
          Object.assign(base, updateSlot(s, 'editor', { workspacePath: path }))
        }
        return base
      })
    },

    setWorkspaceDigest(digest) {
      set({ workspaceDigest: digest, workspaceDigestLoading: false })
    },

    // ─── Session Actions ──────────────────────────────────────────────────

    setActiveSession(sessionId: string | null, context: AgentContext = 'editor') {
      set((state) => ({
        activeSessionId: { ...state.activeSessionId, [context]: sessionId },
        ...(context === 'editor' ? { sessionOutputs: null, sessionOutputsLoading: !!sessionId } : {}),
      }))
    },

    setSessionOutputs(outputs) {
      set({ sessionOutputs: outputs, sessionOutputsLoading: false })
    },

    dispatchSessionList(action: SessionListAction) {
      set(state => ({ sessionList: sessionListReducer(state.sessionList, action) }))
    },

    ensureSessionSlot(sessionId: string) {
      set((state) => {
        if (state.sessionSlots[sessionId]) {
          // Already exists — just update access order
          const accessOrder = state.sessionAccessOrder.filter((id) => id !== sessionId)
          accessOrder.push(sessionId)
          return { sessionAccessOrder: accessOrder }
        }
        // Create new slot and update access order
        const accessOrder = state.sessionAccessOrder.filter((id) => id !== sessionId)
        accessOrder.push(sessionId)
        return {
          sessionSlots: { ...state.sessionSlots, [sessionId]: { ...emptySlot(), currentSessionId: sessionId } },
          sessionAccessOrder: accessOrder,
        }
      })
    },

    switchToSession(sessionId: string, context: AgentContext = 'editor') {
      const state = get()
      if (state.activeSessionId[context] === sessionId) return

      if (!sessionId) {
        set((state) => {
          const cleanSlot: ContextSlot = {
            ...emptySlot(),
            workspacePath: state.slots[context].workspacePath || (context === 'editor' ? state.activeWorkspacePath : null),
          }
          return {
            activeSessionId: { ...state.activeSessionId, [context]: null },
            ...(context === 'editor' ? { sessionOutputs: null, sessionOutputsLoading: false } : {}),
            slots: { ...state.slots, [context]: cleanSlot },
          }
        })
        return
      }

      set((state) => {
        const prevSessionId = state.activeSessionId[context]
        const nextSessionSlots = { ...state.sessionSlots }
        // Track access order: prevSessionId was just active, sessionId is being switched to
        let accessOrder = state.sessionAccessOrder.slice()

        if (prevSessionId && prevSessionId !== sessionId) {
          const slotHasContent = state.slots[context].messages.length > 0
          const savedHasContent = nextSessionSlots[prevSessionId]?.messages?.length > 0
          if (slotHasContent || !savedHasContent) {
            nextSessionSlots[prevSessionId] = { ...state.slots[context] }
          }
          // Move prevSessionId to end of access order (just saved)
          accessOrder = accessOrder.filter((id) => id !== prevSessionId)
          accessOrder.push(prevSessionId)
        }

        const existingSlot = nextSessionSlots[sessionId]
        const sdkSessionId = getSdkSessionIdForClient(state, sessionId)
        const canLoadSdkSession = Boolean(sdkSessionId)
        const targetSlot = existingSlot
          ? {
              ...(canLoadSdkSession && !existingSlot.currentSessionId
                  ? { ...existingSlot, currentSessionId: sessionId }
                  : existingSlot),
              sdkSessionId: existingSlot.sdkSessionId || sdkSessionId,
              _needsSdkLoad: existingSlot._needsSdkLoad ?? false,
              _sdkLoadedCount: existingSlot._sdkLoadedCount ?? existingSlot.messages.length,
              _sdkLoadOffset: existingSlot._sdkLoadOffset ?? existingSlot.messages.length,
              _isLoadingMoreMessages: existingSlot._isLoadingMoreMessages ?? false,
            }
          : {
              ...emptySlot(),
              workspacePath: state.slots[context].workspacePath || (context === 'editor' ? state.activeWorkspacePath : null),
              ...(canLoadSdkSession ? {
                currentSessionId: sessionId,
                sdkSessionId,
                _needsSdkLoad: true,
                _sdkLoadedCount: 0,
                _sdkLoadOffset: 0,
                _isLoadingMoreMessages: false,
              } : { currentSessionId: sessionId }),
            }
        if (!existingSlot) {
          nextSessionSlots[sessionId] = targetSlot
        }
        // Move sessionId to end of access order (just accessed)
        accessOrder = accessOrder.filter((id) => id !== sessionId)
        accessOrder.push(sessionId)

        // LRU eviction for slots created/accessed during switch
        if (accessOrder.length > MAX_SESSION_SLOTS) {
          const protectedIds = new Set<string>()
          protectedIds.add(sessionId) // the new active session
          const editorSid = state.slots.editor.currentSessionId
          const askSid = state.slots.ask.currentSessionId
          if (editorSid) protectedIds.add(editorSid)
          if (askSid) protectedIds.add(askSid)

          const evictCount = accessOrder.length - MAX_SESSION_SLOTS
          let evicted = 0
          const remainingOrder: string[] = []
          for (const candidateId of accessOrder) {
            if (evicted < evictCount && !protectedIds.has(candidateId)) {
              delete nextSessionSlots[candidateId]
              evicted++
            } else {
              remainingOrder.push(candidateId)
            }
          }
          if (evicted > 0) {
            console.info(
              `[AgentStore] LRU evicted ${evicted} session slot(s) during switchToSession ` +
              `(limit: ${MAX_SESSION_SLOTS})`
            )
          }
          accessOrder = remainingOrder
        }

        return {
          activeSessionId: { ...state.activeSessionId, [context]: sessionId },
          sessionSlots: nextSessionSlots,
          sessionAccessOrder: accessOrder,
          ...(context === 'editor' ? { sessionOutputs: null, sessionOutputsLoading: true } : {}),
          slots: { ...state.slots, [context]: targetSlot },
        }
      })

      const targetSlot = get().slots[context]
      if (targetSlot._needsSdkLoad && targetSlot.currentSessionId === sessionId) {
        set({ isResumingSession: true })
        get().loadInitialSessionMessages(sessionId, context).finally(() => {
          if (get().activeSessionId[context] === sessionId) {
            set({ isResumingSession: false })
          }
        }).catch((err) => {
          console.error('[AgentStore] switchToSession: loadInitialSessionMessages failed:', err)
        })
      }
    },

    async loadInitialSessionMessages(sessionId: string, context: AgentContext = 'editor') {
      const slot = get().sessionSlots[sessionId]
      if (!slot || slot._isLoadingMoreMessages) return
      const sdkSessionId = getSdkSessionIdForClient(get(), sessionId)
      if (!sdkSessionId) return

      set((state) => ({
        sessionSlots: {
          ...state.sessionSlots,
          [sessionId]: { ...state.sessionSlots[sessionId], _isLoadingMoreMessages: true },
        },
        ...(state.activeSessionId[context] === sessionId ? {
          slots: {
            ...state.slots,
            [context]: { ...state.slots[context], _isLoadingMoreMessages: true },
          },
        } : {}),
      }))

      try {
        const INITIAL_LIMIT = 10
        const { messages, offset: paginationOffset, hasMore } = await window.api.agent.loadSessionMessagesPaginated(
          sdkSessionId, INITIAL_LIMIT, 0
        )
        const loadedMessages = buildReplayedMessages(messages)

        set((state) => {
          const isActive = state.activeSessionId[context] === sessionId
          const currentSlot = isActive
            ? state.slots[context]
            : (state.sessionSlots[sessionId] || emptySlot())
          const finalSlot: ContextSlot = {
            ...currentSlot,
            messages: mergeLoadedMessages(loadedMessages, currentSlot.messages),
            workspacePath: currentSlot.workspacePath || (context === 'editor' ? state.activeWorkspacePath : null),
            currentSessionId: sessionId,
            sdkSessionId,
            _needsSdkLoad: hasMore,
            _sdkLoadedCount: paginationOffset,
            _sdkLoadOffset: paginationOffset,
            _isLoadingMoreMessages: false,
          }
          return {
            sessionSlots: { ...state.sessionSlots, [sessionId]: finalSlot },
            ...(isActive ? { slots: { ...state.slots, [context]: finalSlot } } : {}),
          }
        })
      } catch (err) {
        console.error('[AgentStore] loadInitialSessionMessages failed:', err)
        set((state) => ({
          sessionSlots: {
            ...state.sessionSlots,
            [sessionId]: { ...state.sessionSlots[sessionId], _isLoadingMoreMessages: false },
          },
          ...(state.slots[context]._isLoadingMoreMessages ? {
            slots: { ...state.slots, [context]: { ...state.slots[context], _isLoadingMoreMessages: false } },
          } : {}),
        }))
      }
    },

    async loadMoreSessionMessages(sessionId: string) {
      const slot = get().sessionSlots[sessionId]
      if (!slot || slot._isLoadingMoreMessages) return
      const sdkSessionId = getSdkSessionIdForClient(get(), sessionId)
      if (!sdkSessionId) return

      const nextOffset = slot._sdkLoadOffset

      // Resolve which UI context owns this session (instead of hardcoding editor).
      const stateBefore = get()
      const owningContext: AgentContext | null =
        stateBefore.activeSessionId.editor === sessionId ? 'editor' :
        stateBefore.activeSessionId.ask === sessionId ? 'ask' :
        null

      set((state) => ({
        sessionSlots: {
          ...state.sessionSlots,
          [sessionId]: { ...state.sessionSlots[sessionId], _isLoadingMoreMessages: true },
        },
        ...(owningContext ? {
          slots: { ...state.slots, [owningContext]: { ...state.slots[owningContext], _isLoadingMoreMessages: true } },
        } : {}),
      }))

      try {
        const LOAD_MORE_LIMIT = 100
        const { messages: olderRawMessages, offset: olderRawOffset, hasMore } = await window.api.agent.loadSessionMessagesPaginated(
          sdkSessionId, LOAD_MORE_LIMIT, nextOffset
        )

        // Guard: if the session is no longer active in any context, write only
        // to sessionSlots (cache), not to any live context slot.
        const stateAfter = get()
        const activeContext: AgentContext | null =
          stateAfter.activeSessionId.editor === sessionId ? 'editor' :
          stateAfter.activeSessionId.ask === sessionId ? 'ask' :
          null

        const olderBuiltMessages = buildReplayedMessages(olderRawMessages)

        set((state) => {
          if (!activeContext) {
            // Session switched away; update cache only.
            const cached = state.sessionSlots[sessionId]
            const updatedSlot: ContextSlot = {
              ...cached,
              messages: mergeLoadedMessages(olderBuiltMessages, cached.messages),
              _sdkLoadOffset: olderRawOffset,
              _sdkLoadedCount: olderRawOffset,
              _needsSdkLoad: hasMore,
              _isLoadingMoreMessages: false,
            }
            return {
              sessionSlots: {
                ...state.sessionSlots,
                [sessionId]: updatedSlot,
              },
            }
          }

          const targetSlot = state.slots[activeContext]
          const currentMessages = targetSlot.messages

          const updatedSlot: ContextSlot = {
            ...targetSlot,
            messages: mergeLoadedMessages(olderBuiltMessages, currentMessages),
            _sdkLoadOffset: olderRawOffset,
            _sdkLoadedCount: olderRawOffset,
            _needsSdkLoad: hasMore,
            _isLoadingMoreMessages: false,
          }
          return {
            slots: { ...state.slots, [activeContext]: updatedSlot },
            sessionSlots: { ...state.sessionSlots, [sessionId]: updatedSlot },
          }
        })
      } catch (err) {
        console.error('[AgentStore] loadMoreSessionMessages failed:', err)
        const stateErr = get()
        const activeCtxErr: AgentContext | null =
          stateErr.activeSessionId.editor === sessionId ? 'editor' :
          stateErr.activeSessionId.ask === sessionId ? 'ask' :
          null
        set((state) => ({
          sessionSlots: {
            ...state.sessionSlots,
            [sessionId]: { ...state.sessionSlots[sessionId], _isLoadingMoreMessages: false },
          },
          ...(activeCtxErr ? {
            slots: { ...state.slots, [activeCtxErr]: { ...state.slots[activeCtxErr], _isLoadingMoreMessages: false } },
          } : {}),
        }))
      }
    },

    async renameCurrentSession(title: string) {
      const sessionId = get().activeSessionId.editor
      if (!sessionId) return

      // Always update sessionList optimistically — this includes new-
      // sessions whose real sessionId has not been assigned yet. The
      // SDK rename & electron-store persist are deferred to onSessionCreated
      // which reads the title from sessionList after MATERIALIZE.
      set((state) => ({
        sessionList: state.sessionList.map((s) =>
          s.id === sessionId ? { ...s, title } : s
        ),
      }))

      const sdkSessionId = getSdkSessionIdForClient(get(), sessionId)
      if (!sdkSessionId) return

      try {
        await window.api.agent.renameSession(sdkSessionId, title)
      } catch (err) {
        console.error('[AgentStore] renameCurrentSession SDK rename failed:', err)
      }
      // Persist to electron-store regardless of SDK outcome so the title
      // survives restarts even when listSessions does not pick up customTitle.
      window.api.agent.updateSessionRecord(sessionId, { title, sdkSessionId }).catch(() => {})
    },
  }
})

if (import.meta.hot) {
  import.meta.hot.dispose((data) => {
    data.state = useAgentStore.getState()
  })
  if (import.meta.hot.data?.state) {
    useAgentStore.setState(import.meta.hot.data.state, true)
  }
}
