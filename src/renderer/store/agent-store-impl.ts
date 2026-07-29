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
  SessionRoutedPermissionRequest,
  SessionRoutedAskUserRequest,
  SessionRoutedRequestTimeout,
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
  enqueueAskUserInteraction,
  enqueuePermissionInteraction,
  getSdkSessionIdForClient,
  normalizeSessionId,
  patchActiveContextSlot,
  patchSessionScopedSlot,
  patchSessionSlot,
  removeSessionSlotPatch,
  resolveAskUserInteraction,
  resolveClientSessionId,
  resolvePermissionInteraction,
  resolveSessionSlot,
} from './session-slot-state'
import { isSameWorkspacePath } from '../../shared/workspace-paths'

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

    handlePermissionRequest(req: SessionRoutedPermissionRequest) {
      set((state) => enqueuePermissionInteraction(state, req).patch)
    },

    // ─── Permission / AskUser response & timeout handlers ──────────────────
    // session-slot-state owns the live/cache representation and routing seam.

    handlePermissionResponse(requestId: string, _behavior: 'allow' | 'deny') {
      set((state) => resolvePermissionInteraction(state, requestId).patch)
    },

    handleAskUserRequest(req: SessionRoutedAskUserRequest) {
      const mutation = enqueueAskUserInteraction(get(), req)
      set(mutation.patch)
      if (mutation.target) {
        get().dispatchAgentEvent(
          { type: 'ASK_USER_REQUEST' },
          mutation.target.context,
          mutation.target.sessionId,
        )
      }
    },

    handleAskUserResponse(requestId: string, answers: Record<string, string>) {
      const displayAnswer = Object.values(answers).filter(Boolean).join('；') || Object.keys(answers).join(', ')
      const createdAt = Date.now()
      const state = get()
      const mutation = resolveAskUserInteraction(state, requestId, {
        kind: 'user',
        id: `user-answer-${createdAt}`,
        role: 'user',
        textContent: displayAnswer,
        createdAt,
      })
      set(mutation.patch)
      return mutation.target
    },

    handleAskUserTimeout(timeout: SessionRoutedRequestTimeout) {
      const createdAt = Date.now()
      const state = get()
      const mutation = resolveAskUserInteraction(state, timeout.requestId, {
        kind: 'status',
        id: `timeout-${createdAt}`,
        role: 'system',
        phase: 'complete',
        textContent: '☕ 等了很久没有回应，我先休息一下，有事随时沟通',
        createdAt,
      })
      set(mutation.patch)
      if (mutation.target) {
        get().dispatchAgentEvent(
          { type: 'ASK_USER_TIMEOUT' },
          mutation.target.context,
          mutation.target.sessionId,
        )
      }
    },

    handlePermissionTimeout(timeout: SessionRoutedRequestTimeout) {
      set((state) => resolvePermissionInteraction(state, timeout.requestId).patch)
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
        const permissionItems = mergeById<SessionRoutedPermissionRequest>([
          sourceSlot?.permissionRequest,
          ...(sourceSlot?.permissionQueue || []),
          realSlot?.permissionRequest,
          ...(realSlot?.permissionQueue || []),
        ])
        const askUserItems = mergeById<SessionRoutedAskUserRequest>([
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
        }
        const cachedSlot = state.sessionSlots[clientSessionKey] || baseSlot
        const nextCachedSlot: ContextSlot = {
          ...cachedSlot,
          messages: nextSlot.messages,
          ...(skill ? { activeSkillId: skill.id } : {}),
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

    // ─── Workspace Actions ────────────────────────────────────────────────

    setActiveWorkspace(path: string | null) {
      set((state) => {
        const currentSlot = state.slots.editor
        const currentSessionId = state.activeSessionId.editor || currentSlot.currentSessionId
        const listedWorkspacePath = currentSessionId
          ? state.sessionList.find((session) => (
              session.id === currentSessionId || session.sdkSessionId === currentSessionId
            ))?.workspacePath
          : null
        const currentSessionWorkspacePath = currentSlot.workspacePath
          || (currentSessionId ? state.sessionSlots[currentSessionId]?.workspacePath : null)
          || listedWorkspacePath
          || null
        const canRetainEditorSession = Boolean(
          path
          && currentSessionId
          && currentSessionWorkspacePath
          && isSameWorkspacePath(currentSessionWorkspacePath, path),
        )
        const canRetainUnmaterializedSlot = Boolean(
          path
          && !currentSessionId
          && (
            (currentSlot.workspacePath && isSameWorkspacePath(currentSlot.workspacePath, path))
            || (state.activeWorkspacePath && isSameWorkspacePath(state.activeWorkspacePath, path))
          ),
        )

        if (canRetainEditorSession || canRetainUnmaterializedSlot) {
          return {
            activeWorkspacePath: path,
            ...patchSessionSlot(state, 'editor', { workspacePath: path }, currentSessionId),
          }
        }

        const cachePatch = currentSessionId
          ? cacheSessionSlot(state, currentSessionId, { ...currentSlot })
          : {}
        return {
          activeWorkspacePath: path,
          activeSessionId: { ...state.activeSessionId, editor: null },
          sessionOutputs: null,
          sessionOutputsLoading: false,
          sessionLoadError: null,
          ...cachePatch,
          slots: {
            ...state.slots,
            editor: { ...emptySlot(), workspacePath: path },
          },
        }
      })
    },

    removeWorkspaceState(workspacePath, fallbackWorkspacePath, removedSessionIds = []) {
      set((state) => {
        const removedIds = new Set(removedSessionIds)
        for (const session of state.sessionList) {
          if (session.workspacePath && isSameWorkspacePath(session.workspacePath, workspacePath)) {
            removedIds.add(session.id)
            if (session.sdkSessionId) removedIds.add(session.sdkSessionId)
          }
        }
        for (const [sessionId, slot] of Object.entries(state.sessionSlots)) {
          if (slot.workspacePath && isSameWorkspacePath(slot.workspacePath, workspacePath)) {
            removedIds.add(sessionId)
          }
        }

        const editorSessionId = state.activeSessionId.editor || state.slots.editor.currentSessionId
        const editorBelongsToDeletedWorkspace = Boolean(
          (state.activeWorkspacePath
            && isSameWorkspacePath(state.activeWorkspacePath, workspacePath))
          || (state.slots.editor.workspacePath
            && isSameWorkspacePath(state.slots.editor.workspacePath, workspacePath))
          || (editorSessionId && removedIds.has(editorSessionId)),
        )
        const sessionSlots = Object.fromEntries(
          Object.entries(state.sessionSlots)
            .filter(([sessionId, slot]) => (
              !removedIds.has(sessionId)
              && (!slot.workspacePath || !isSameWorkspacePath(slot.workspacePath, workspacePath))
            )),
        )

        return {
          activeWorkspacePath: editorBelongsToDeletedWorkspace
            ? fallbackWorkspacePath
            : state.activeWorkspacePath,
          activeSessionId: editorBelongsToDeletedWorkspace
            ? { ...state.activeSessionId, editor: null }
            : state.activeSessionId,
          sessionList: state.sessionList.filter((session) => (
            !removedIds.has(session.id)
            && (!session.workspacePath || !isSameWorkspacePath(session.workspacePath, workspacePath))
          )),
          sessionSlots,
          sessionAccessOrder: state.sessionAccessOrder.filter((sessionId) => (
            !removedIds.has(sessionId) && Boolean(sessionSlots[sessionId])
          )),
          ...(editorBelongsToDeletedWorkspace
            ? {
                slots: {
                  ...state.slots,
                  editor: { ...emptySlot(), workspacePath: fallbackWorkspacePath },
                },
                sessionOutputs: null,
                sessionOutputsLoading: false,
                sessionLoadError: null,
              }
            : {}),
        }
      })
    },

    // ─── Session Actions ──────────────────────────────────────────────────

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
        const { messages, cursor, hasMore } = await window.api.agent.loadSessionMessagesPaginated(
          sessionId, INITIAL_LIMIT, null
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
            _sessionPageCursor: cursor,
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

      const nextCursor = slot._sessionPageCursor
      if (!nextCursor) return

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
        const { messages: olderRawMessages, cursor, hasMore } = await window.api.agent.loadSessionMessagesPaginated(
          sessionId, LOAD_MORE_LIMIT, nextCursor
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
              _sessionPageCursor: cursor,
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
            _sessionPageCursor: cursor,
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
