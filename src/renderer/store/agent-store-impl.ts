import { create } from 'zustand'
import type { AgentStore, ContextSlot } from './agent-store'
import { emptySlot } from './agent-store'
import { sessionListReducer, type SessionListAction } from './session-protocol'
import type {
  AgentContext,
  AgentIPCMessage,
  AgentIPCMessageWithContext,
  AgentSessionEnvelope,
  AgentEvent,
  ConversationMessage,
  PermissionRequestIPC,
  AskUserRequestIPC,
  SessionRoutedGenerationActivity,
} from '../../shared/types'
import {
  buildReplayedMessages,
  reduceAgentMessage,
} from './message-pipeline'
import { reduceAgentEvent } from './agent-state-machine'
import {
  buildSessionSwitchPatch,
  cacheSessionSlot,
  ensureSessionSlotPatch,
  getSdkSessionIdForClient,
  normalizeSessionId,
  patchActiveContextSlot,
  patchSessionScopedSlot,
  patchSessionSlot,
  removeSessionSlotPatch,
  resolveClientSessionId,
  resolveSessionSlot,
} from './session-slot-state'

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

function mergeMessages(...groups: ConversationMessage[][]): ConversationMessage[] {
  const seen = new Set<string>()
  const merged: ConversationMessage[] = []
  for (const group of groups) {
    for (const message of group) {
      if (seen.has(message.id)) continue
      seen.add(message.id)
      merged.push(message)
    }
  }
  return merged
}

function mergeById<T extends { id: string }>(items: Array<T | null | undefined>): T[] {
  const seen = new Set<string>()
  const merged: T[] = []
  for (const item of items) {
    if (!item || seen.has(item.id)) continue
    seen.add(item.id)
    merged.push(item)
  }
  return merged
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// ─── Store ─────────────────────────────────────────────────────────────

export const useAgentStore = create<AgentStore>((set, get) => {
  return {
    context: 'editor',
    slots: { editor: emptySlot(), ask: emptySlot() },
    sessionList: [],
    sessionSlots: {},
    sessionAccessOrder: [],
    activeWorkspacePath: null,
    activeSessionId: { editor: null, ask: null },
    sessionOutputs: null,
    sessionOutputsLoading: false,
    sessionLoadError: null,

    // ─── State Machine ──────────────────────────────────────────────────

    dispatchAgentEvent(event: AgentEvent, eventContext?: AgentContext, eventSid?: string | null) {
      const ctx = eventContext || get().context
      set((state) => {
        // Use resolveSessionSlot to get the correct slot — it handles the case
        // where sessionSlots has an auto-created stale entry that would
        // shadow the live slot before sessionCreated fires.
        const slot = resolveSessionSlot(state, ctx, eventSid)
        return patchSessionSlot(state, ctx, reduceAgentEvent(slot, event), eventSid)
      })
    },

    // ─── Core Reducer ───────────────────────────────────────────────────

    processIPCMessage(msg: AgentIPCMessageWithContext | AgentIPCMessage, options?: { isReplay?: boolean }) {
      const isReplay = options?.isReplay ?? false
      const routed = msg as AgentIPCMessage & Partial<AgentSessionEnvelope> & { session_id?: string }
      const ctx = routed.context || get().context
      const rawEventSessionId = routed.clientSessionKey
        || routed.sessionId
        || routed.session_id
        || undefined
      const eventSessionId = resolveClientSessionId(get(), rawEventSessionId) || undefined

      // Replay restores message content, but must not drive the live FSM.
      if (isReplay) {
        const sourceSlot = resolveSessionSlot(get(), ctx, eventSessionId)
        const { patch } = reduceAgentMessage(sourceSlot, msg, 'replay')
        if (patch && Object.keys(patch).length > 0) {
          set((state) => patchSessionSlot(state, ctx, patch, eventSessionId))
        }
        return
      }

      // Live dispatch reads the routed slot inside set() for freshness. Message
      // projection and its FSM effects are applied to the same slot atomically.
      set((state) => {
        const sourceSlot = resolveSessionSlot(state, ctx, eventSessionId)
        const { patch, events, firstContentSeenDuringThisCall } = reduceAgentMessage(
          sourceSlot,
          msg,
          'live'
        )

        let slotUpdates: Partial<ContextSlot> = patch ? { ...patch } : {}
        let projectedSlot: ContextSlot = { ...sourceSlot, ...slotUpdates }
        const effectEvents = [...events]
        if (
          firstContentSeenDuringThisCall
          && (projectedSlot.agentState === 'thinking' || projectedSlot.agentState === 'compacting')
        ) {
          effectEvents.push({ type: 'FIRST_CONTENT' })
        }

        for (const event of effectEvents) {
          const eventPatch = reduceAgentEvent(projectedSlot, event)
          slotUpdates = { ...slotUpdates, ...eventPatch }
          projectedSlot = { ...projectedSlot, ...eventPatch }
        }

        return Object.keys(slotUpdates).length > 0
          ? patchSessionSlot(state, ctx, slotUpdates, eventSessionId)
          : {}
      })
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
            return patchSessionSlot(state, ctx, patch, sid)
          })
        }
        return
      }

      set((state) => {
        const slot = state.slots[ctx]
        if (slot.permissionRequest) {
          return patchSessionSlot(state, ctx, { permissionQueue: [...slot.permissionQueue, req] })
        }
        return patchSessionSlot(state, ctx, { permissionRequest: req })
      })

    },

    // ─── Permission / AskUser response & timeout handlers ──────────────────
    // These search BOTH the active slots and sessionSlots, because a
    // permission or AskUser request belongs to a specific session and may
    // be resident in either location depending on timing.

    handlePermissionResponse(requestId: string, _behavior: 'allow' | 'deny') {
      set((state) => {
        // 1) Search active slots
        for (const ctx of ['editor', 'ask'] as AgentContext[]) {
          const slot = state.slots[ctx]
          if (slot.permissionRequest?.id === requestId) {
            const permRespSid = slot.permissionRequest.sessionId || null
            const next = slot.permissionQueue[0] ?? null
            const rest = slot.permissionQueue.slice(1)
            return patchSessionScopedSlot(state, ctx, { permissionRequest: next, permissionQueue: rest }, permRespSid)
          }
          const qIdx = slot.permissionQueue.findIndex((r) => r.id === requestId)
          if (qIdx !== -1) {
            const queuedSid = slot.permissionQueue[qIdx].sessionId || null
            const filtered = [...slot.permissionQueue]
            filtered.splice(qIdx, 1)
            return patchSessionScopedSlot(state, ctx, { permissionQueue: filtered }, queuedSid)
          }
        }
        // 2) Search sessionSlots for sessions that are not currently active
        for (const [sid, slot] of Object.entries(state.sessionSlots)) {
          if (slot.permissionRequest?.id === requestId) {
            const next = slot.permissionQueue[0] ?? null
            const rest = slot.permissionQueue.slice(1)
            return patchSessionScopedSlot(state, slot.permissionRequest.context || 'editor', { permissionRequest: next, permissionQueue: rest }, sid)
          }
          const qIdx = slot.permissionQueue.findIndex((r) => r.id === requestId)
          if (qIdx !== -1) {
            const filtered = [...slot.permissionQueue]
            const queuedSid = filtered[qIdx].sessionId || sid
            const queuedContext = filtered[qIdx].context || 'editor'
            filtered.splice(qIdx, 1)
            return patchSessionScopedSlot(state, queuedContext, { permissionQueue: filtered }, queuedSid)
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
            return patchSessionSlot(state, ctx, patch, sid)
          })
          get().dispatchAgentEvent({ type: 'ASK_USER_REQUEST' }, ctx, reqSessionId)
        }
        return
      }

      set((state) => {
        const slot = state.slots[ctx]
        if (slot.askUserRequest) {
          return patchSessionSlot(state, ctx, { askUserQueue: [...slot.askUserQueue, req] })
        }
        return patchSessionSlot(state, ctx, { askUserRequest: req })
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
              return patchSessionScopedSlot(state, slot.askUserRequest.context || 'editor', {
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
        return patchSessionScopedSlot(state, ctx, {
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
              const updated = patchSessionScopedSlot(state, requestContext, {
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
        const updated = patchSessionScopedSlot(state, ctx, {
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
            return patchSessionScopedSlot(state, ctx, { permissionRequest: next, permissionQueue: rest }, permTOSid)
          }
          const qIdx = slot.permissionQueue.findIndex((r) => r.id === requestId)
          if (qIdx !== -1) {
            const queuedSid = slot.permissionQueue[qIdx].sessionId || null
            const filtered = [...slot.permissionQueue]
            filtered.splice(qIdx, 1)
            return patchSessionScopedSlot(state, ctx, { permissionQueue: filtered }, queuedSid)
          }
        }
        // 2) Search sessionSlots
        for (const [sid, slot] of Object.entries(state.sessionSlots)) {
          if (slot.permissionRequest?.id === requestId) {
            const next = slot.permissionQueue[0] ?? null
            const rest = slot.permissionQueue.slice(1)
            return patchSessionScopedSlot(state, slot.permissionRequest.context || 'editor', { permissionRequest: next, permissionQueue: rest }, sid)
          }
          const qIdx = slot.permissionQueue.findIndex((r) => r.id === requestId)
          if (qIdx !== -1) {
            const filtered = [...slot.permissionQueue]
            const queuedSid = filtered[qIdx].sessionId || sid
            const queuedContext = filtered[qIdx].context || 'editor'
            filtered.splice(qIdx, 1)
            return patchSessionScopedSlot(state, queuedContext, { permissionQueue: filtered }, queuedSid)
          }
        }
        return {}
      })
    },

    handleGenerationActivity(activity: SessionRoutedGenerationActivity) {
      const terminal = activity.phase === 'completed' || activity.phase === 'failed' || activity.phase === 'cancelled'
      set((s) => patchSessionScopedSlot(
        s,
        activity.context,
        { generationActivity: terminal ? null : activity },
        activity.sessionId,
      ))
    },

    setContext(context: AgentContext) {
      set({ context })
    },

    setPrefill(context: AgentContext, text: string) {
      set((s) => patchSessionSlot(s, context, { prefillText: text }))
    },

    consumePrefill(context: AgentContext) {
      set((s) => patchSessionSlot(s, context, { prefillText: null }))
    },

    updateComposerDraft(context, patch, sessionId) {
      set((state) => {
        if (sessionId) {
          const targetSlot = resolveSessionSlot(state, context, sessionId)
          return patchSessionScopedSlot(state, context, {
            composerDraft: { ...targetSlot.composerDraft, ...patch },
          }, sessionId)
        }

        const activeSlot = state.slots[context]
        return patchActiveContextSlot(state, context, {
          composerDraft: { ...activeSlot.composerDraft, ...patch },
        })
      })
    },

    setApprovalMode(context, mode, sessionId) {
      set((state) => {
        if (sessionId) {
          return patchSessionScopedSlot(state, context, { approvalMode: mode }, sessionId)
        }
        return patchActiveContextSlot(state, context, { approvalMode: mode })
      })
    },

    setLinkedFile(context: AgentContext, path: string | null) {
      set((state) => patchActiveContextSlot(state, context, { linkedFile: path }))
    },

    dismissTodo(context: AgentContext) {
      set((state) => patchActiveContextSlot(state, context, { todoList: null }))
    },

    markArtifactSaved(context: AgentContext, messageId: string, filePath: string) {
      set((state) => {
        const slot = state.slots[context]
        const messageIndex = slot.messages.findIndex((message) => message.id === messageId)
        if (messageIndex < 0 || slot.messages[messageIndex].kind !== 'artifact') return {}

        const messages = [...slot.messages]
        const message = messages[messageIndex]
        if (message.kind !== 'artifact') return {}
        messages[messageIndex] = {
          ...message,
          artifact: { ...message.artifact, filePath, content: undefined },
        }
        return patchActiveContextSlot(state, context, { messages })
      })
    },

    clearContextSession(context: AgentContext) {
      set((state) => ({
        activeSessionId: { ...state.activeSessionId, [context]: null },
        slots: {
          ...state.slots,
          [context]: {
            ...emptySlot(),
            workspacePath: context === 'editor'
              ? (state.slots.editor.workspacePath || state.activeWorkspacePath)
              : null,
          },
        },
        ...(context === 'editor' ? { sessionOutputs: null, sessionOutputsLoading: false } : {}),
      }))
    },

    materializeSession(envelope: AgentSessionEnvelope) {
      const clientSessionKey = envelope.clientSessionKey || envelope.sessionId
      const sdkSessionId = envelope.sdkSessionId || envelope.sessionId
      const sessionTitle = get().sessionList.find((session) => session.id === clientSessionKey)?.title

      set((state) => {
        const currentActiveId = state.activeSessionId[envelope.context]
        const clientSlot = state.sessionSlots[clientSessionKey]
        const sdkSlot = clientSessionKey !== sdkSessionId ? state.sessionSlots[sdkSessionId] : undefined
        const activeSlotIsClient = currentActiveId === clientSessionKey || currentActiveId === sdkSessionId
        const sourceSlot = clientSlot || (activeSlotIsClient ? state.slots[envelope.context] : undefined)
        const realSlot = sdkSlot
        const baseSlot = sourceSlot || realSlot || emptySlot()
        const permissionItems = mergeById<PermissionRequestIPC>([
          sourceSlot?.permissionRequest,
          ...(sourceSlot?.permissionQueue || []),
          realSlot?.permissionRequest,
          ...(realSlot?.permissionQueue || []),
        ])
        const askUserItems = mergeById<AskUserRequestIPC>([
          sourceSlot?.askUserRequest,
          ...(sourceSlot?.askUserQueue || []),
          realSlot?.askUserRequest,
          ...(realSlot?.askUserQueue || []),
        ])
        const materializedSlot: ContextSlot = {
          ...baseSlot,
          ...(sourceSlot || {}),
          ...(realSlot || {}),
          messages: mergeMessages(sourceSlot?.messages || [], realSlot?.messages || []),
          isStreaming: Boolean(sourceSlot?.isStreaming || realSlot?.isStreaming),
          agentState: realSlot?.agentState && realSlot.agentState !== 'idle'
            ? realSlot.agentState
            : (sourceSlot?.agentState || baseSlot.agentState),
          _acc: realSlot?._acc || sourceSlot?._acc || null,
          _firstContentSeen: Boolean(realSlot?._firstContentSeen || sourceSlot?._firstContentSeen),
          _processedArtifactIds: new Set([
            ...(sourceSlot?._processedArtifactIds || []),
            ...(realSlot?._processedArtifactIds || []),
          ]),
          _queryGeneration: Math.max(sourceSlot?._queryGeneration || 0, realSlot?._queryGeneration || 0),
          _resultGuardGen: Math.max(sourceSlot?._resultGuardGen || 0, realSlot?._resultGuardGen || 0),
          permissionRequest: permissionItems[0] || null,
          permissionQueue: permissionItems.slice(1),
          askUserRequest: askUserItems[0] || null,
          askUserQueue: askUserItems.slice(1),
          generationActivity: realSlot?.generationActivity || sourceSlot?.generationActivity || null,
          activeSkillId: realSlot?.activeSkillId || sourceSlot?.activeSkillId || null,
          lastEditedFile: realSlot?.lastEditedFile || sourceSlot?.lastEditedFile || null,
          usageInfo: realSlot?.usageInfo || sourceSlot?.usageInfo || null,
          todoList: realSlot?.todoList || sourceSlot?.todoList || null,
          composerDraft: sourceSlot?.composerDraft || realSlot?.composerDraft || baseSlot.composerDraft,
          approvalMode: sourceSlot?.approvalMode || realSlot?.approvalMode || baseSlot.approvalMode,
          currentSessionId: clientSessionKey,
          sdkSessionId,
          workspacePath: envelope.workspacePath || sourceSlot?.workspacePath || realSlot?.workspacePath || null,
        }

        const cachePatch = cacheSessionSlot(state, clientSessionKey, materializedSlot, {
          removeIds: sdkSessionId !== clientSessionKey ? [sdkSessionId] : [],
        })

        const isStillActiveSession =
          currentActiveId === clientSessionKey ||
          currentActiveId === sdkSessionId ||
          currentActiveId === null

        const next: Partial<AgentStore> = {
          ...cachePatch,
        }
        if (isStillActiveSession) {
          next.activeSessionId = { ...state.activeSessionId, [envelope.context]: clientSessionKey }
          next.slots = { ...state.slots, [envelope.context]: materializedSlot }
        }
        if (envelope.context === 'editor') {
          next.sessionList = sessionListReducer(state.sessionList, {
            type: 'MATERIALIZE',
            tempId: clientSessionKey,
            realId: sdkSessionId,
            context: envelope.context,
            workspacePath: envelope.workspacePath,
            title: sessionTitle,
          })
          if (envelope.workspacePath && !state.activeWorkspacePath) {
            next.activeWorkspacePath = envelope.workspacePath
          }
        }
        return next
      })

      return { clientSessionKey, sdkSessionId, sessionTitle }
    },

    appendInactivityNotice(context: AgentContext, sessionId?: string | null) {
      const normalizedSessionId = normalizeSessionId(sessionId)
      set((state) => {
        const target = resolveSessionSlot(state, context, normalizedSessionId)
        return patchSessionScopedSlot(state, context, {
          messages: [...target.messages, {
            kind: 'status',
            id: `watchdog-${Date.now()}`,
            role: 'system',
            phase: 'complete',
            textContent: '任务已经 2 分钟没有新进度，但仍在运行。你可以继续等待，或点击停止。',
            createdAt: Date.now(),
          }],
        }, normalizedSessionId)
      })
    },

    beginMessage(
      context: AgentContext,
      visibleText: string,
      skill?: { id: string; name: string; icon: string },
    ) {
      let sessionId = get().slots[context].currentSessionId
      if (!sessionId) sessionId = `new-${context}-${Date.now()}`
      const clientSessionKey = sessionId

      set((state) => {
        const isNewSession = !state.slots[context].currentSessionId
        const baseSlot = isNewSession
          ? { ...state.slots[context], currentSessionId: clientSessionKey, sdkSessionId: null }
          : state.slots[context]
        const nextSlot: ContextSlot = {
          ...baseSlot,
          messages: [...baseSlot.messages, {
            kind: 'user',
            id: `user-${Date.now()}`,
            role: 'user',
            textContent: visibleText,
            ...(skill ? {
              skillMeta: {
                id: skill.id,
                name: skill.name,
                icon: skill.icon,
                status: 'running',
              },
            } : {}),
            createdAt: Date.now(),
          }],
          ...(skill ? { activeSkillId: skill.id } : {}),
          isStreaming: true,
        }
        const cachedSlot = state.sessionSlots[clientSessionKey] || baseSlot
        const nextCachedSlot: ContextSlot = {
          ...cachedSlot,
          messages: nextSlot.messages,
          ...(skill ? { activeSkillId: skill.id } : {}),
          isStreaming: true,
          currentSessionId: clientSessionKey,
        }
        const cachePatch = cacheSessionSlot(state, clientSessionKey, nextCachedSlot)
        return {
          ...(isNewSession
            ? { activeSessionId: { ...state.activeSessionId, [context]: clientSessionKey } }
            : {}),
          slots: { ...state.slots, [context]: nextSlot },
          ...cachePatch,
        }
      })

      return clientSessionKey
    },

    startNewSession(context: AgentContext) {
      set((state) => {
        const currentSlot = state.slots[context]
        const currentSessionId = currentSlot.currentSessionId || state.activeSessionId[context]
        const cachePatch = currentSessionId
          ? cacheSessionSlot(state, currentSessionId, { ...currentSlot })
          : {}
        return {
          activeSessionId: { ...state.activeSessionId, [context]: null },
          ...(context === 'editor' ? { sessionOutputs: null, sessionOutputsLoading: false } : {}),
          ...cachePatch,
          slots: {
            ...state.slots,
            [context]: { ...emptySlot(), workspacePath: currentSlot.workspacePath },
          },
        }
      })
    },

    // ─── Workspace Actions ────────────────────────────────────────────────

    setActiveWorkspace(path: string | null) {
      set((s) => {
        const base: Partial<AgentStore> = { activeWorkspacePath: path }
        if (path) {
          Object.assign(base, patchSessionSlot(s, 'editor', { workspacePath: path }))
        }
        return base
      })
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

    setSessionOutputsLoading(loading: boolean) {
      set({ sessionOutputsLoading: loading })
    },

    dispatchSessionList(action: SessionListAction) {
      set(state => ({ sessionList: sessionListReducer(state.sessionList, action) }))
    },

    removeSessionState(sessionId: string) {
      set((state) => {
        return {
          sessionList: sessionListReducer(state.sessionList, { type: 'DELETE', sessionId }),
          ...removeSessionSlotPatch(state, sessionId),
        }
      })
    },

    ensureSessionSlot(sessionId: string) {
      set((state) => ensureSessionSlotPatch(state, sessionId))
    },

    switchToSession(sessionId: string, context: AgentContext = 'editor', workspacePath?: string | null) {
      const state = get()
      if (state.activeSessionId[context] === sessionId) return

      set((state) => buildSessionSwitchPatch(state, context, sessionId, workspacePath))
      if (!sessionId) return

      const targetSlot = get().slots[context]
      if (targetSlot._needsSdkLoad && targetSlot.currentSessionId === sessionId) {
        set({ sessionLoadError: null })
        get().loadInitialSessionMessages(sessionId, context).catch((err) => {
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
        sessionLoadError: state.sessionLoadError?.sessionId === sessionId ? null : state.sessionLoadError,
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
          sessionId, INITIAL_LIMIT, 0
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
            sessionLoadError: state.sessionLoadError?.sessionId === sessionId ? null : state.sessionLoadError,
            ...(isActive ? { slots: { ...state.slots, [context]: finalSlot } } : {}),
          }
        })
      } catch (err) {
        console.error('[AgentStore] loadInitialSessionMessages failed:', err)
        const message = getErrorMessage(err)
        set((state) => ({
          sessionSlots: {
            ...state.sessionSlots,
            [sessionId]: { ...state.sessionSlots[sessionId], _isLoadingMoreMessages: false },
          },
          sessionLoadError: {
            sessionId,
            context,
            phase: 'initial',
            message,
          },
          ...(state.activeSessionId[context] === sessionId
            && state.slots[context].currentSessionId === sessionId
            && state.slots[context]._isLoadingMoreMessages ? {
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
        sessionLoadError: state.sessionLoadError?.sessionId === sessionId ? null : state.sessionLoadError,
        ...(owningContext ? {
          slots: { ...state.slots, [owningContext]: { ...state.slots[owningContext], _isLoadingMoreMessages: true } },
        } : {}),
      }))

      try {
        const LOAD_MORE_LIMIT = 100
        const { messages: olderRawMessages, offset: olderRawOffset, hasMore } = await window.api.agent.loadSessionMessagesPaginated(
          sessionId, LOAD_MORE_LIMIT, nextOffset
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
              sessionLoadError: state.sessionLoadError?.sessionId === sessionId ? null : state.sessionLoadError,
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
            sessionLoadError: state.sessionLoadError?.sessionId === sessionId ? null : state.sessionLoadError,
          }
        })
      } catch (err) {
        console.error('[AgentStore] loadMoreSessionMessages failed:', err)
        const message = getErrorMessage(err)
        const stateErr = get()
        const activeCtxErr: AgentContext | null =
          stateErr.activeSessionId.editor === sessionId ? 'editor' :
          stateErr.activeSessionId.ask === sessionId ? 'ask' :
          null
        const context = activeCtxErr || owningContext || 'editor'
        set((state) => ({
          sessionSlots: {
            ...state.sessionSlots,
            [sessionId]: { ...state.sessionSlots[sessionId], _isLoadingMoreMessages: false },
          },
          sessionLoadError: {
            sessionId,
            context,
            phase: 'more',
            message,
          },
          ...(activeCtxErr ? {
            slots: { ...state.slots, [activeCtxErr]: { ...state.slots[activeCtxErr], _isLoadingMoreMessages: false } },
          } : {}),
        }))
      }
    },

    clearSessionLoadError() {
      set({ sessionLoadError: null })
    },

    async retrySessionLoad() {
      const error = get().sessionLoadError
      if (!error) return

      set({ sessionLoadError: null })
      if (error.phase === 'more') {
        await get().loadMoreSessionMessages(error.sessionId)
      } else {
        await get().loadInitialSessionMessages(error.sessionId, error.context)
      }
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
