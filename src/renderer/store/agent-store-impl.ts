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
  // active session, event matches slot's session, OR no session is confirmed
  // for this context yet (sessionCreated hasn't fired).
  if (!sid || sid === state.activeSessionId[ctx] || sid === slotSid || !slotSid) {
    return state.slots[ctx]
  }
  // Event is for a different (background) session → use its cached slot
  if (state.sessionSlots[sid]) {
    return state.sessionSlots[sid]
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

    processIPCMessage(msg: AgentIPCMessage & { context?: AgentContext; sessionId?: string }, options?: { isReplay?: boolean }) {
      const isReplay = options?.isReplay ?? false
      const ctx = msg.context || get().context
      const eventSessionId = ((msg as Record<string, unknown>).sessionId as string)
        || ((msg as Record<string, unknown>).session_id as string)
        || undefined

      
        // For replay, use a different dispatch path that doesn't involve reducers
        if (isReplay) {
          // Replay: stream events are skipped, others follow the normal path
          if (msg.type === 'stream_event') { /* skip during replay */ return }

          switch (msg.type) {
            case 'system': {
              const { patch, events } = reduceSystemMessage(
                get().slots[ctx], msg as unknown as AgentIPCMessage & { subtype?: string; session_id?: string; message?: string; tool_use_id?: string }
              )
              if (Object.keys(patch).length > 0) {
                set((state) => updateSlot(state, ctx, patch, eventSessionId))
              }
              dispatchEffectEvents(eventSessionId || null, events, ctx)
              break
            }
            case 'assistant': {
              const { patch, events } = reduceAssistantMessage(get().slots[ctx], msg as AssistantPayload)
              set((state) => updateSlot(state, ctx, patch, eventSessionId))
              dispatchEffectEvents(eventSessionId || null, events, ctx)
              break
            }
            case 'user': {
              const patch = reduceUserMessage(get().slots[ctx], msg as UserPayload, isReplay)
              if (patch) set((state) => updateSlot(state, ctx, patch, eventSessionId))
              break
            }
            case 'result': {
              const { patch, events } = reduceResultMessage(
                get().slots[ctx],
                msg as AgentIPCMessage & { subtype?: string },
                get().slots[ctx]._resultGuardGen
              )
              if (patch) set((state) => updateSlot(state, ctx, patch, eventSessionId))
              dispatchEffectEvents(eventSessionId || null, events, ctx)
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
                  const currentState = get().slots[ctx].agentState
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
        const slotSid = get().slots[ctx]?.currentSessionId
        const isOtherSession = !!(slotSid && req.sessionId && req.sessionId !== slotSid)
        const isNewSessionGuard = !!(!req.sessionId && slotSid && !slotSid.startsWith('new-'))
        if (isOtherSession || isNewSessionGuard) {
          // The request belongs to a background session — don't show the dialog,
          // but DO persist into sessionSlots so it appears when the user switches.
          if (req.sessionId) {
            set((state) => {
              const sid = req.sessionId!
              const isNew = !state.sessionSlots[sid]
              const bgSlot = isNew ? emptySlot() : state.sessionSlots[sid]
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
              return updateSlot(state, ctx, { permissionRequest: next, permissionQueue: rest })
          }
          const qIdx = slot.permissionQueue.findIndex((r) => r.id === requestId)
          if (qIdx !== -1) {
            const filtered = [...slot.permissionQueue]
            filtered.splice(qIdx, 1)
            return updateSlot(state, ctx, { permissionQueue: filtered })
          }
        }
        // 2) Search sessionSlots for sessions that are not currently active
        for (const [sid, slot] of Object.entries(state.sessionSlots)) {
          if (slot.permissionRequest?.id === requestId) {

              const next = slot.permissionQueue[0] ?? null
              const rest = slot.permissionQueue.slice(1)
              return updateSlot(state, 'editor', { permissionRequest: next, permissionQueue: rest })
          }
          const qIdx = slot.permissionQueue.findIndex((r) => r.id === requestId)
          if (qIdx !== -1) {

              const filtered = [...slot.permissionQueue]
              filtered.splice(qIdx, 1)
              return updateSlot(state, 'editor', { permissionQueue: filtered })
          }
        }
        return {}
      })
    },

    handleAskUserRequest(req: AskUserRequestIPC) {
        // Use the context slot's own sessionId, not global activeSessionId.
        const ctx = (req.context as AgentContext) || get().context
        const slotSid = get().slots[ctx]?.currentSessionId
        const isOtherSession = !!(slotSid && req.sessionId && req.sessionId !== slotSid)
        const isNewSessionGuard = !!(!req.sessionId && slotSid && !slotSid.startsWith('new-'))
        if (isOtherSession || isNewSessionGuard) {
          // Background session — persist into sessionSlots so the dialog
          // appears naturally when the user switches to this session.
          if (req.sessionId) {
            set((state) => {
              const sid = req.sessionId!
              const isNew = !state.sessionSlots[sid]
              const bgSlot = isNew ? emptySlot() : state.sessionSlots[sid]
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
        get().dispatchAgentEvent({ type: 'ASK_USER_REQUEST' }, ctx)

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
                return updateSlot(state, 'editor', {
                  messages: [...slot.messages, { kind: 'user' as const, id: `user-answer-${Date.now()}`, role: 'user', textContent: displayAnswer, createdAt: Date.now() }],
                  askUserRequest: next, askUserQueue: rest,
                })
            }
          }
          return {}
        }

        const s = state.slots[ctx]
          const next = s.askUserQueue[0] ?? null
          const rest = s.askUserQueue.slice(1)
          return updateSlot(state, ctx, {
            messages: [...s.messages, { kind: 'user' as const, id: `user-answer-${Date.now()}`, role: 'user', textContent: displayAnswer, createdAt: Date.now() }],
            askUserRequest: next, askUserQueue: rest,
          })
      })
    },

    handleAskUserTimeout(requestId: string) {
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
                const updated = updateSlot(state, 'editor', {
                  messages: [...slot.messages, { kind: 'status' as const, id: `timeout-${Date.now()}`, role: 'system', phase: 'complete', textContent: '☕ 等了很久没有回应，我先休息一下，有事随时沟通', createdAt: Date.now() }],
                  askUserRequest: next, askUserQueue: rest,
                })
                get().dispatchAgentEvent({ type: 'ASK_USER_TIMEOUT' }, 'editor')
                return updated
            }
          }
          return {}
        }

        const s = state.slots[ctx]
          const next = s.askUserQueue[0] ?? null
          const rest = s.askUserQueue.slice(1)
          const updated = updateSlot(state, ctx, {
            messages: [...s.messages, { kind: 'status' as const, id: `timeout-${Date.now()}`, role: 'system', phase: 'complete', textContent: '☕ 等了很久没有回应，我先休息一下，有事随时沟通', createdAt: Date.now() }],
            askUserRequest: next, askUserQueue: rest,
          })
          get().dispatchAgentEvent({ type: 'ASK_USER_TIMEOUT' }, ctx)
          return updated
      })
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
              return updateSlot(state, ctx, { permissionRequest: next, permissionQueue: rest })
          }
          const qIdx = slot.permissionQueue.findIndex((r) => r.id === requestId)
          if (qIdx !== -1) {
            const filtered = [...slot.permissionQueue]
            filtered.splice(qIdx, 1)
            return updateSlot(state, ctx, { permissionQueue: filtered })
          }
        }
        // 2) Search sessionSlots
        for (const [sid, slot] of Object.entries(state.sessionSlots)) {
          if (slot.permissionRequest?.id === requestId) {

              const next = slot.permissionQueue[0] ?? null
              const rest = slot.permissionQueue.slice(1)
              return updateSlot(state, 'editor', { permissionRequest: next, permissionQueue: rest })
          }
          const qIdx = slot.permissionQueue.findIndex((r) => r.id === requestId)
          if (qIdx !== -1) {

              const filtered = [...slot.permissionQueue]
              filtered.splice(qIdx, 1)
              return updateSlot(state, 'editor', { permissionQueue: filtered })
          }
        }
        return {}
      })
    },

    handleSkillOutput(skillState: SkillOutputState) {
      const skillSid = skillState.sessionId || null
      const ctx = skillState.context || get().context
        set((s) => updateSlot(s, ctx, { skillOutput: skillState }))

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

    setActiveSession(sessionId: string | null) {
      set((state) => ({ activeSessionId: { ...state.activeSessionId, editor: sessionId }, sessionOutputs: null, sessionOutputsLoading: !!sessionId }))
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
          sessionSlots: { ...state.sessionSlots, [sessionId]: emptySlot() },
          sessionAccessOrder: accessOrder,
        }
      })
    },

    switchToSession(sessionId: string) {
      const state = get()
      if (state.activeSessionId.editor === sessionId) return

      if (!sessionId) {
        set((state) => {
          const cleanSlot: ContextSlot = {
            ...emptySlot(),
            workspacePath: state.slots.editor.workspacePath || state.activeWorkspacePath,
          }
          return {
            activeSessionId: { ...state.activeSessionId, editor: null },
            sessionOutputs: null,
            sessionOutputsLoading: false,
            slots: { ...state.slots, editor: cleanSlot },
          }
        })
        return
      }

      set((state) => {
        const prevSessionId = state.activeSessionId.editor
        const nextSessionSlots = { ...state.sessionSlots }
        // Track access order: prevSessionId was just active, sessionId is being switched to
        let accessOrder = state.sessionAccessOrder.slice()

        if (prevSessionId && prevSessionId !== sessionId) {
          const editorHasContent = state.slots.editor.messages.length > 0
          const savedHasContent = nextSessionSlots[prevSessionId]?.messages?.length > 0
          if (editorHasContent || !savedHasContent) {
            nextSessionSlots[prevSessionId] = { ...state.slots.editor }
          }
          // Move prevSessionId to end of access order (just saved)
          accessOrder = accessOrder.filter((id) => id !== prevSessionId)
          accessOrder.push(prevSessionId)
        }

        const existingSlot = nextSessionSlots[sessionId]
        const isRealSession = sessionId && !sessionId.startsWith('new-')
        const targetSlot = existingSlot
          ? {
              ...(isRealSession && !existingSlot.currentSessionId
                  ? { ...existingSlot, currentSessionId: sessionId }
                  : existingSlot),
              _needsSdkLoad: existingSlot._needsSdkLoad ?? false,
              _sdkLoadedCount: existingSlot._sdkLoadedCount ?? existingSlot.messages.length,
              _sdkLoadOffset: existingSlot._sdkLoadOffset ?? existingSlot.messages.length,
              _isLoadingMoreMessages: existingSlot._isLoadingMoreMessages ?? false,
            }
          : {
              ...emptySlot(),
              workspacePath: state.slots.editor.workspacePath || state.activeWorkspacePath,
              ...(isRealSession ? {
                currentSessionId: sessionId,
                _needsSdkLoad: true,
                _sdkLoadedCount: 0,
                _sdkLoadOffset: 0,
                _isLoadingMoreMessages: false,
              } : {}),
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
          activeSessionId: { ...state.activeSessionId, editor: sessionId },
          sessionSlots: nextSessionSlots,
          sessionAccessOrder: accessOrder,
          sessionOutputs: null,
          sessionOutputsLoading: true,
          slots: { ...state.slots, editor: targetSlot },
        }
      })

      const editorSlot = get().slots.editor
      if (editorSlot._needsSdkLoad && editorSlot.currentSessionId === sessionId) {
        set({ isResumingSession: true })
        get().loadInitialSessionMessages(sessionId).finally(() => {
          if (get().activeSessionId.editor === sessionId) {
            set({ isResumingSession: false })
          }
        }).catch((err) => {
          console.error('[AgentStore] switchToSession: loadInitialSessionMessages failed:', err)
        })
      }
    },

    async loadInitialSessionMessages(sessionId: string) {
      const slot = get().sessionSlots[sessionId]
      if (!slot || slot._isLoadingMoreMessages) return

      set((state) => ({
        sessionSlots: {
          ...state.sessionSlots,
          [sessionId]: { ...state.sessionSlots[sessionId], _isLoadingMoreMessages: true },
        },
      }))

      try {
        const INITIAL_LIMIT = 200
        const { messages: rawMessages, offset: rawOffset } = await window.api.agent.loadSessionMessagesPaginated(
          sessionId, INITIAL_LIMIT + 1, 0
        )
        const hasMore = rawMessages.length > INITIAL_LIMIT
        const messages = hasMore ? rawMessages.slice(0, INITIAL_LIMIT) : rawMessages
        const loadedCount = messages.length
        const paginationOffset = rawOffset

        if (get().activeSessionId.editor !== sessionId) {
          set((state) => ({
            sessionSlots: {
              ...state.sessionSlots,
              [sessionId]: { ...state.sessionSlots[sessionId], _isLoadingMoreMessages: false },
            },
          }))
          return
        }

        set((state) => {
          const curSlot = state.slots.editor
          const cleared: ContextSlot = {
            ...emptySlot(),
            workspacePath: curSlot.workspacePath || state.activeWorkspacePath,
            currentSessionId: sessionId,
            _needsSdkLoad: false,
            _sdkLoadedCount: paginationOffset,
            _sdkLoadOffset: paginationOffset,
            _isLoadingMoreMessages: true,
          }
          return {
            slots: { ...state.slots, editor: cleared },
            sessionSlots: { ...state.sessionSlots, [sessionId]: cleared },
          }
        })

        for (const msg of messages) {
          get().processIPCMessage(msg as AgentIPCMessage & { context?: AgentContext; sessionId?: string }, { isReplay: true })
        }

        set((state) => {
          const editorSlot = state.slots.editor
          const finalSlot: ContextSlot = {
            ...editorSlot,
            _needsSdkLoad: hasMore,
            _sdkLoadedCount: paginationOffset,
            _sdkLoadOffset: paginationOffset,
            _isLoadingMoreMessages: false,
          }
          return {
            slots: { ...state.slots, editor: finalSlot },
            sessionSlots: { ...state.sessionSlots, [sessionId]: finalSlot },
          }
        })
      } catch (err) {
        console.error('[AgentStore] loadInitialSessionMessages failed:', err)
        set((state) => ({
          sessionSlots: {
            ...state.sessionSlots,
            [sessionId]: { ...state.sessionSlots[sessionId], _isLoadingMoreMessages: false },
          },
          ...(state.slots.editor._isLoadingMoreMessages ? {
            slots: { ...state.slots, editor: { ...state.slots.editor, _isLoadingMoreMessages: false } },
          } : {}),
        }))
      }
    },

    async loadMoreSessionMessages(sessionId: string) {
      const slot = get().sessionSlots[sessionId]
      if (!slot || slot._isLoadingMoreMessages) return

      const nextOffset = slot._sdkLoadOffset

      set((state) => ({
        sessionSlots: {
          ...state.sessionSlots,
          [sessionId]: { ...state.sessionSlots[sessionId], _isLoadingMoreMessages: true },
        },
        ...(state.slots.editor.currentSessionId === sessionId ? {
          slots: { ...state.slots, editor: { ...state.slots.editor, _isLoadingMoreMessages: true } },
        } : {}),
      }))

      try {
        const LOAD_MORE_LIMIT = 100
        const { messages: olderRawMessages, offset: olderRawOffset } = await window.api.agent.loadSessionMessagesPaginated(
          sessionId, LOAD_MORE_LIMIT + 1, nextOffset
        )
        const hasMore = olderRawMessages.length > LOAD_MORE_LIMIT
        const olderMessages = hasMore ? olderRawMessages.slice(0, LOAD_MORE_LIMIT) : olderRawMessages

        const olderBuiltMessages = buildReplayedMessages(olderMessages)
        const newTotal = olderRawOffset

        set((state) => {
          const editorSlot = state.slots.editor
          const currentMessages = editorSlot.messages

          const updatedEditorSlot: ContextSlot = {
            ...editorSlot,
            messages: [...olderBuiltMessages, ...currentMessages],
            _sdkLoadOffset: olderRawOffset,
            _sdkLoadedCount: olderRawOffset,
            _needsSdkLoad: hasMore,
            _isLoadingMoreMessages: false,
          }
          return {
            slots: { ...state.slots, editor: updatedEditorSlot },
            sessionSlots: { ...state.sessionSlots, [sessionId]: updatedEditorSlot },
          }
        })
      } catch (err) {
        console.error('[AgentStore] loadMoreSessionMessages failed:', err)
        set((state) => ({
          sessionSlots: {
            ...state.sessionSlots,
            [sessionId]: { ...state.sessionSlots[sessionId], _isLoadingMoreMessages: false },
          },
          ...(state.slots.editor.currentSessionId === sessionId ? {
            slots: { ...state.slots, editor: { ...state.slots.editor, _isLoadingMoreMessages: false } },
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

      // Temp sessions can't be renamed on the SDK side (no real ID yet).
      // The title is picked up by onSessionCreated during MATERIALIZE.
      if (sessionId.startsWith('new-')) return

      try {
        await window.api.agent.renameSession(sessionId, title)
      } catch (err) {
        console.error('[AgentStore] renameCurrentSession SDK rename failed:', err)
      }
      // Persist to electron-store regardless of SDK outcome so the title
      // survives restarts even when listSessions does not pick up customTitle.
      window.api.agent.updateSessionRecord(sessionId, { title }).catch(() => {})
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
