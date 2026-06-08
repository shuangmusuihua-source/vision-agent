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
  StoppedMessage,
  ContentBlock,
  ToolCallState,
  ArtifactData,
  ArtifactFileType,
  PermissionRequestIPC,
  AskUserRequestIPC,
  StreamingAccumulator,
  SkillOutputState,
  SystemInitPayload,
  SystemStatusPayload,
  SystemCompactBoundaryPayload,
  SystemPermissionDeniedPayload,
  AssistantPayload,
  UserPayload,
  ResultSuccessPayload,
  ResultErrorPayload,
  StreamEventPayloadIPC,
  StreamContentBlockDelta,
  TextDelta,
  InputJsonDelta,
  StreamContentBlockStart,
} from '../../shared/types'
import { AGENT_TRANSITIONS as TRANSITIONS, isTextBlock, isToolUseBlock, isToolResultBlock } from '../../shared/types'

// ─── Slot helpers ────────────────────────────────────────────────────────

function updateSlot(
  state: AgentStore,
  ctx: AgentContext,
  patch: Partial<ContextSlot>
): Partial<AgentStore> {
  return {
    slots: {
      ...state.slots,
      [ctx]: { ...state.slots[ctx], ...patch },
    },
  }
}

// ─── Accumulator helpers ──────────────────────────────────────────────

export function ensureAccumulator(messageId: string, slot: ContextSlot): StreamingAccumulator {
  if (slot._acc && slot._acc.messageId === messageId) return slot._acc
  return {
    messageId,
    text: '',
    toolUseBlocks: new Map(),
    thinkingText: '',
  }
}

export function commitAccumulator(acc: StreamingAccumulator, slot: ContextSlot, content: ContentBlock[], phase: TextMessage['phase']): Partial<ContextSlot> {
  const msgIdx = slot.messages.findIndex((m) => m.id === acc.messageId)
  if (msgIdx < 0) return { _acc: null }
  const existing = slot.messages[msgIdx]
  if (existing.kind !== 'text') return { _acc: null }

  const textContent = acc.text
  const toolCalls: ToolCallState[] = []

  for (const [id, block] of acc.toolUseBlocks) {
    let input: Record<string, unknown> = {}
    try { input = JSON.parse(block.inputJson) } catch {}
    toolCalls.push({ toolUseId: id, toolName: block.name, input, status: 'running' })
  }

  const hasToolUse = content.some((b) => b.type === 'tool_use')
  const hasText = content.some((b) => b.type === 'text')

  const updatedMessages = [...slot.messages]
  updatedMessages[msgIdx] = {
    ...existing,
    phase,
    textContent: hasText ? (content.find(isTextBlock))?.text || textContent : textContent,
    content: content.length > 0 ? content : existing.content,
    toolCalls: hasToolUse
      ? content.filter(isToolUseBlock).map((tu) => {
          let input: Record<string, unknown> = {}
          if (tu.input && typeof tu.input === 'object') input = tu.input
          return { toolUseId: tu.id, toolName: tu.name, input, status: 'running' as const }
        })
      : toolCalls,
  } as TextMessage

  return { messages: updatedMessages, _acc: null }
}

// ─── Artifact Extraction ────────────────────────────────────────────────

export function extractSkillOutputContent(text: string): string | null {
  const match = text.match(/```skill-output\n([\s\S]*?)```/)
  if (match) return match[1]
  const partial = text.match(/```skill-output\n([\s\S]*)$/)
  if (partial) return partial[1]
  return null
}

function fileTypeFromExt(filePath: string): ArtifactFileType {
  const ext = filePath.split('.').pop()?.toLowerCase()
  if (ext === 'html' || ext === 'htm') return 'html'
  if (ext === 'svg') return 'svg'
  if (ext === 'json') return 'json'
  if (ext === 'png' || ext === 'jpg' || ext === 'jpeg') return 'png'
  return 'md'
}

function fileTypeFromContent(content: string): ArtifactFileType {
  const trimmed = content.trimStart()
  if (trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<html')) return 'html'
  if (trimmed.startsWith('<svg')) return 'svg'
  return 'md'
}

function extractArtifactFromMessage(msg: ConversationMessage): ArtifactData | null {
  if (msg.kind !== 'text') return null
  const skillContent = extractSkillOutputContent(msg.textContent)
  if (skillContent) {
    const writeTool = msg.toolCalls.find(
      (tc) => (tc.toolName === 'Write' || tc.toolName === 'Edit') && tc.status === 'completed'
    )
    const filePath = (writeTool?.input as Record<string, unknown>)?.file_path as string | undefined
    const fileType = filePath ? fileTypeFromExt(filePath) : fileTypeFromContent(skillContent)
    return {
      fileName: filePath ? filePath.split('/').pop()! : `artifact-${msg.id.slice(-6)}.${fileType}`,
      fileType,
      filePath,
      content: skillContent,
    }
  }

  const writeTool = msg.toolCalls.find(
    (tc) => (tc.toolName === 'Write' || tc.toolName === 'Edit') && tc.status === 'completed'
  )
  if (writeTool) {
    const filePath = (writeTool.input as Record<string, unknown>)?.file_path as string
    if (filePath) {
      return { fileName: filePath.split('/').pop() || 'artifact', fileType: fileTypeFromExt(filePath), filePath }
    }
  }
  return null
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

// ─── Message Handlers (one per IPC message type) ─────────────────────

type StoreApi = {
  set: (partial: Partial<AgentStore> | ((state: AgentStore) => Partial<AgentStore>)) => void
  get: () => AgentStore
}

function handleSystemMessage(
  { set, get }: StoreApi,
  ctx: AgentContext,
  _msg: AgentIPCMessage
): void {
  const msg = _msg as AgentIPCMessage & { subtype?: string; session_id?: string; message?: string; tool_use_id?: string }
  if (msg.subtype === 'init') {
    const initMsg = msg as SystemInitPayload
    const slot = get().slots[ctx]
    if (initMsg.session_id && !slot.currentSessionId) {
      set((state) => updateSlot(state, ctx, { currentSessionId: initMsg.session_id }))
    }
    return
  }
  if (msg.subtype === 'status') {
    const statusMsg = msg as SystemStatusPayload
    if (statusMsg.status === 'compacting') {
      get().dispatchAgentEvent({ type: 'COMPACT_BOUNDARY' }, ctx)
    } else if (statusMsg.status === 'requesting') {
      get().dispatchAgentEvent({ type: 'STATUS_REQUESTING' }, ctx)
    }
    return
  }
  if (msg.subtype === 'compact_boundary') {
    get().dispatchAgentEvent({ type: 'COMPACT_BOUNDARY' }, ctx)
    return
  }
  if (msg.subtype === 'permission_denied') {
    const pdMsg = msg as SystemPermissionDeniedPayload
    set((state) => {
      const slot = state.slots[ctx]
      const targetMsg = slot.messages.find((m): m is TextMessage =>
        m.kind === 'text' && m.toolCalls.some((tc) => tc.toolUseId === pdMsg.tool_use_id)
      )
      if (targetMsg) {
        const msgs = [...slot.messages]
        const idx = msgs.indexOf(targetMsg)
        msgs[idx] = {
          ...targetMsg,
          toolCalls: targetMsg.toolCalls.map((tc) =>
            tc.toolUseId === pdMsg.tool_use_id
              ? { ...tc, status: 'error' as const, result: `Permission denied: ${pdMsg.message}` }
              : tc
          ),
        }
        return updateSlot(state, ctx, { messages: msgs })
      }
      return {}
    })
  }
}

function handleAssistantMessage(
  { set, get }: StoreApi,
  ctx: AgentContext,
  msg: AgentIPCMessage
): void {
  const assistantMsg = msg as AssistantPayload
  const content = assistantMsg.message.content
  const slot = get().slots[ctx]

  if (!slot._firstContentSeen) {
    set((state) => updateSlot(state, ctx, { _firstContentSeen: true }))
    get().dispatchAgentEvent({ type: 'FIRST_CONTENT' }, ctx)
  }

  set((state) => {
    const s = state.slots[ctx]
    if (s._acc) {
      const commitUpdates = commitAccumulator(s._acc, s, content, 'complete')
      return updateSlot(state, ctx, commitUpdates)
    }

    const msgId = assistantMsg.uuid || `assistant-${Date.now()}`
    const textContent = content.filter(isTextBlock).map((b) => b.text).join('')
    const toolCalls: ToolCallState[] = content.filter(isToolUseBlock).map((tu) => {
      let input: Record<string, unknown> = {}
      if (tu.input && typeof tu.input === 'object') input = tu.input
      return { toolUseId: tu.id || `tu-${Date.now()}`, toolName: tu.name || 'unknown', input, status: 'running' as const }
    })

    const newMsg: TextMessage = {
      kind: 'text',
      id: msgId,
      role: 'assistant',
      phase: 'complete',
      textContent,
      content,
      toolCalls: toolCalls.filter((tc) => tc.toolName !== 'AskUserQuestion'),
      createdAt: Date.now(),
    }

    return updateSlot(state, ctx, { messages: [...s.messages, newMsg] })
  })
}

// ─── Stream event sub-handlers ─────────────────────────────────────────

function handleTextDelta(
  { set, get }: StoreApi,
  ctx: AgentContext,
  text: string
): void {
  set((state) => {
    const s = state.slots[ctx]
    let acc = s._acc
    if (!acc) {
      let msgId = `assistant-${Date.now()}`
      const lastMsg = s.messages[s.messages.length - 1]
      if (lastMsg?.kind === 'text' && lastMsg.phase !== 'complete') {
        msgId = lastMsg.id
      } else {
        const newAcc = ensureAccumulator(msgId, s)
        newAcc.text = text
        const newMsg: TextMessage = {
          kind: 'text', id: msgId, role: 'assistant', phase: 'streaming',
          textContent: text, content: [], toolCalls: [], createdAt: Date.now(),
        }
        const msgs = [...s.messages.filter((m) => !(m.kind === 'status' && m.phase === 'streaming')), newMsg]
        return updateSlot(state, ctx, { messages: msgs, _acc: newAcc, isStreaming: true })
      }
      acc = ensureAccumulator(msgId, s)
    }

    acc.text += text

    const msgs = [...s.messages]
    const idx = msgs.findIndex((m) => m.id === acc!.messageId)
    if (idx >= 0 && msgs[idx].kind === 'text') {
      msgs[idx] = { ...msgs[idx], textContent: acc.text, phase: 'streaming' }
    }

    if (!s._firstContentSeen) {
      // Fire synchronously — deferring via setTimeout in an IPC handler
      // (especially during background session swap in processIPCMessage)
      // causes dispatchAgentEvent to fire after the slot swap is restored,
      // transitioning the WRONG session's agentState.
      get().dispatchAgentEvent({ type: 'FIRST_CONTENT' }, ctx)
    }

    return updateSlot(state, ctx, { messages: msgs, _acc: acc, _firstContentSeen: true })
  })
}

function handleInputJsonDelta(
  { set }: StoreApi,
  ctx: AgentContext,
  partialJson: string
): void {
  set((state) => {
    const s = state.slots[ctx]
    const acc = s._acc
    if (!acc) return {}
    const blocks = Array.from(acc.toolUseBlocks.entries())
    if (blocks.length > 0) {
      const [lastId, lastBlock] = blocks[blocks.length - 1]
      acc.toolUseBlocks.set(lastId, { ...lastBlock, inputJson: lastBlock.inputJson + partialJson })

      const msgs = [...s.messages]
      const idx = msgs.findIndex((m) => m.id === acc.messageId)
      if (idx >= 0 && msgs[idx].kind === 'text') {
        const updatedToolCalls = msgs[idx].toolCalls.map((tc) =>
          tc.toolUseId === lastId
            ? { ...tc, inputJsonPartial: acc.toolUseBlocks.get(lastId)!.inputJson }
            : tc
        )
        msgs[idx] = { ...msgs[idx], toolCalls: updatedToolCalls }
      }
      return updateSlot(state, ctx, { messages: msgs, _acc: acc })
    }
    return {}
  })
}

function handleContentBlockStart(
  { set, get }: StoreApi,
  ctx: AgentContext,
  block: ContentBlock
): void {
  set((state) => {
    const s = state.slots[ctx]
    let acc = s._acc
    if (!acc) {
      let msgId = `assistant-${Date.now()}`
      const lastMsg = s.messages[s.messages.length - 1]
      if (lastMsg?.kind === 'text' && lastMsg.phase !== 'complete') {
        msgId = lastMsg.id
      } else {
        const newMsg: TextMessage = {
          kind: 'text', id: msgId, role: 'assistant', phase: 'tool_calling',
          textContent: '', content: [], toolCalls: [], createdAt: Date.now(),
        }
        const msgs = [...s.messages.filter((m) => !(m.kind === 'status' && m.phase === 'streaming')), newMsg]
        const newAcc = ensureAccumulator(msgId, s)
        if (!s._firstContentSeen) {
          setTimeout(() => get().dispatchAgentEvent({ type: 'FIRST_CONTENT' }, ctx), 0)
        }
        return updateSlot(state, ctx, { messages: msgs, _acc: newAcc, isStreaming: true, _firstContentSeen: true })
      }
      acc = ensureAccumulator(msgId, s)
    }

    if (!s._firstContentSeen) {
      setTimeout(() => get().dispatchAgentEvent({ type: 'FIRST_CONTENT' }, ctx), 0)
    }

    if (block.type === 'tool_use') {
      const name = block.name || 'unknown'
      acc.toolUseBlocks.set(block.id, { name, inputJson: '' })

      const newToolCall: ToolCallState = {
        toolUseId: block.id, toolName: name, input: {}, inputJsonPartial: '', status: 'pending',
      }

      const msgs = [...s.messages]
      const idx = msgs.findIndex((m) => m.id === acc!.messageId)
      if (idx >= 0 && msgs[idx].kind === 'text') {
        const existing = msgs[idx].toolCalls.some((tc) => tc.toolUseId === block.id)
        if (!existing) {
          msgs[idx] = { ...msgs[idx], toolCalls: [...msgs[idx].toolCalls, newToolCall], phase: 'tool_calling' }
        }
      }
      return updateSlot(state, ctx, { messages: msgs, _acc: acc, _firstContentSeen: true })
    }
    return {}
  })
}

function handleContentBlockStop(
  { set }: StoreApi,
  ctx: AgentContext
): void {
  set((state) => {
    const s = state.slots[ctx]
    const acc = s._acc
    if (!acc) return {}
    const msgs = [...s.messages]
    const idx = msgs.findIndex((m) => m.id === acc.messageId)
    if (idx < 0 || msgs[idx].kind !== 'text') return {}

    const updatedToolCalls = msgs[idx].toolCalls.map((tc) => {
      const block = acc.toolUseBlocks.get(tc.toolUseId)
      if (!block) return tc
      let input: Record<string, unknown> = {}
      try { input = JSON.parse(block.inputJson) } catch {}
      return { ...tc, input, inputJsonPartial: undefined, status: 'running' as const }
    })
    msgs[idx] = { ...msgs[idx], toolCalls: updatedToolCalls } as TextMessage

    const writeOrEdit = updatedToolCalls.find(
      (tc) => (tc.toolName === 'Write' || tc.toolName === 'Edit') && tc.status === 'running'
    )
    if (writeOrEdit) {
      const filePath = (writeOrEdit.input as Record<string, unknown>)?.file_path as string
      if (filePath) {
        return updateSlot(state, ctx, { messages: msgs, lastEditedFile: filePath, _acc: acc })
      }
    }
    return updateSlot(state, ctx, { messages: msgs, _acc: acc })
  })
}

function handleStreamEventMessage(
  store: StoreApi,
  ctx: AgentContext,
  msg: AgentIPCMessage,
  isReplay: boolean
): void {
  if (isReplay) return

  const streamMsg = msg as StreamEventPayloadIPC
  const event = streamMsg.event

  switch (event.type) {
    case 'content_block_delta': {
      const deltaEvent = event as StreamContentBlockDelta
      const delta = deltaEvent.delta
      if (delta.type === 'text_delta') {
        handleTextDelta(store, ctx, (delta as TextDelta).text)
      } else if (delta.type === 'input_json_delta') {
        handleInputJsonDelta(store, ctx, (delta as InputJsonDelta).partial_json)
      }
      return
    }
    case 'content_block_start': {
      handleContentBlockStart(store, ctx, (event as StreamContentBlockStart).content_block)
      return
    }
    case 'content_block_stop': {
      handleContentBlockStop(store, ctx)
      return
    }
    case 'message_start':
    case 'message_delta':
    case 'message_stop':
      return
  }
}

// ─── User message handler ──────────────────────────────────────────────

function handleUserMessage(
  { set }: StoreApi,
  ctx: AgentContext,
  msg: AgentIPCMessage,
  isReplay: boolean
): void {
  const userMsg = msg as UserPayload
  const content = userMsg.message.content

  set((state) => {
    const s = state.slots[ctx]
    const toolResults = content.filter(isToolResultBlock)
    const textBlocks = content.filter(isTextBlock)
    const msgs = [...s.messages]
    let changed = false

    if (toolResults.length > 0) {
      for (const tr of toolResults) {
        const toolUseId = tr.tool_use_id
        const resultContent = typeof tr.content === 'string'
          ? tr.content
          : Array.isArray(tr.content)
            ? tr.content.map((c) => (typeof c === 'object' && c && 'text' in c ? (c as { text: string }).text : '')).join('')
            : JSON.stringify(tr.content)
        const isError = tr.is_error === true

        for (let i = 0; i < msgs.length; i++) {
          if (msgs[i].kind !== 'text') continue
          const msgRef = msgs[i] as TextMessage
          const tcIdx = msgRef.toolCalls.findIndex((tc) => tc.toolUseId === toolUseId)
          if (tcIdx >= 0) {
            const updatedToolCalls = [...msgRef.toolCalls]
            updatedToolCalls[tcIdx] = { ...updatedToolCalls[tcIdx], result: resultContent, status: isError ? 'error' : 'completed' }
            msgs[i] = { ...msgRef, toolCalls: updatedToolCalls }
            changed = true
            break
          }
        }
      }
    }

    // Replay dedup: during session replay (loadInitialSessionMessages /
    // loadMoreSessionMessages), add the user message from the SDK only if it
    // isn't already present in the messages array. Since the slot is cleared
    // before replay begins, this would normally never encounter a duplicate —
    // but it guards against edge cases where an optimistic insert from
    // sendMessage happens to overlap with a concurrent replay, or when the
    // same user message appears in both the replayed batch and the pre-existing
    // messages (e.g. during loadMoreSessionMessages where originalMessages
    // are merged back after replay completes).
    if (isReplay && textBlocks.length > 0) {
      const text = textBlocks.map((b) => b.text).join('')
      if (text && !msgs.some((m) => m.kind === 'user' && m.textContent === text)) {
        msgs.push({ kind: 'user', id: userMsg.uuid || `user-${Date.now()}`, role: 'user', textContent: text, createdAt: Date.now() })
        changed = true
      }
    }

    return changed ? updateSlot(state, ctx, { messages: msgs }) : {}
  })
}

// ─── Result handler ─────────────────────────────────────────────────────

function handleResultMessage(
  { set, get }: StoreApi,
  ctx: AgentContext,
  _msg: AgentIPCMessage
): void {
  const msg = _msg as AgentIPCMessage & { subtype?: string }
  if (msg.subtype === 'success') {
    const resultMsg = msg as ResultSuccessPayload
    set((state) => updateSlot(state, ctx, { usageInfo: resultMsg.usage }))
    get().dispatchAgentEvent({ type: 'RESULT_SUCCESS' }, ctx)
  } else {
    const errorMsg = msg as ResultErrorPayload
    const errorText = errorMsg.errors.join('\n') || 'Agent error'
    const isAborted = /aborted|cancelled|canceled/i.test(errorText)
    const abortGuardGen = isAborted ? get().slots[ctx]._resultGuardGen : undefined

    set((state) => {
      const s = state.slots[ctx]
      if (abortGuardGen !== undefined && s._queryGeneration !== abortGuardGen) return {}
      const lastMsg = s.messages[s.messages.length - 1]
      if (isAborted) {
        const stopNote: StoppedMessage = {
          kind: 'stopped', id: `stop-${Date.now()}`, role: 'assistant', phase: 'stopped',
          textContent: '我的思考被用户停止了', createdAt: Date.now(),
        }
        const msgs = lastMsg?.kind === 'text' && lastMsg.phase === 'streaming'
          ? [...s.messages.slice(0, -1), { ...lastMsg, phase: 'complete' as const }, stopNote]
          : [...s.messages, stopNote]
        return updateSlot(state, ctx, { messages: msgs, usageInfo: errorMsg.usage })
      }
      return updateSlot(state, ctx, {
        messages: [...s.messages, {
          kind: 'text' as const, id: `error-${Date.now()}`, role: 'assistant', phase: 'error',
          textContent: errorText, content: [], toolCalls: [], createdAt: Date.now(),
        }],
        usageInfo: errorMsg.usage,
      })
    })

    if (abortGuardGen === undefined || get().slots[ctx]._queryGeneration === abortGuardGen) {
      get().dispatchAgentEvent({ type: 'RESULT_ERROR' }, ctx)
    }
  }
}

// ─── Replayed Message Builder (pure — no store access) ─────────────────

/**
 * Convert raw AgentIPCMessages (from the paginated session API) into
 * ConversationMessage[] without touching the Zustand store.  This avoids
 * temporal coupling: the editor slot stays intact while we build older
 * messages locally, so streaming IPC events arriving mid-load are never lost.
 */
function buildReplayedMessages(rawMessages: AgentIPCMessage[]): ConversationMessage[] {
  const messages: ConversationMessage[] = []

  for (const raw of rawMessages) {
    if (raw.type === 'assistant') {
      const assistantMsg = raw as AssistantPayload
      const content = assistantMsg.message.content
      const msgId = assistantMsg.uuid || `assistant-${Date.now()}`
      const textContent = content.filter(isTextBlock).map(b => b.text).join('')
      const toolCalls: ToolCallState[] = content.filter(isToolUseBlock).map(tu => {
        let input: Record<string, unknown> = {}
        if (tu.input && typeof tu.input === 'object') input = tu.input
        return {
          toolUseId: tu.id || `tu-${Date.now()}`,
          toolName: tu.name || 'unknown',
          input,
          status: 'running' as const,
        }
      })

      messages.push({
        kind: 'text',
        id: msgId,
        role: 'assistant',
        phase: 'complete',
        textContent,
        content,
        toolCalls: toolCalls.filter(tc => tc.toolName !== 'AskUserQuestion'),
        createdAt: Date.now(),
      })
    } else if (raw.type === 'user') {
      const userMsg = raw as UserPayload
      const content = userMsg.message.content
      const toolResults = content.filter(isToolResultBlock)
      const textBlocks = content.filter(isTextBlock)

      // Merge tool results into previously-built assistant messages
      if (toolResults.length > 0) {
        for (const tr of toolResults) {
          const toolUseId = tr.tool_use_id
          const resultContent = typeof tr.content === 'string'
            ? tr.content
            : Array.isArray(tr.content)
              ? tr.content.map(c => (typeof c === 'object' && c && 'text' in c ? (c as { text: string }).text : '')).join('')
              : JSON.stringify(tr.content)
          const isError = tr.is_error === true

          for (let i = 0; i < messages.length; i++) {
            if (messages[i].kind !== 'text') continue
            const msgRef = messages[i] as TextMessage
            const tcIdx = msgRef.toolCalls.findIndex(tc => tc.toolUseId === toolUseId)
            if (tcIdx >= 0) {
              const updated = [...msgRef.toolCalls]
              updated[tcIdx] = {
                ...updated[tcIdx],
                result: resultContent,
                status: (isError ? 'error' : 'completed') as ToolCallState['status'],
              }
              messages[i] = { ...msgRef, toolCalls: updated } as TextMessage
              break
            }
          }
        }
      }

      // Push user text message (de-duplicated by content)
      if (textBlocks.length > 0) {
        const text = textBlocks.map(b => b.text).join('')
        if (text && !messages.some(m => m.kind === 'user' && m.textContent === text)) {
          messages.push({
            kind: 'user',
            id: userMsg.uuid || `user-${Date.now()}`,
            role: 'user',
            textContent: text,
            createdAt: Date.now(),
          })
        }
      }
    } else if (raw.type === 'system') {
      const sysSubtype = (raw as Record<string, unknown>).subtype as string | undefined
      if (sysSubtype === 'permission_denied') {
        const pd = raw as SystemPermissionDeniedPayload
        for (let i = 0; i < messages.length; i++) {
          if (messages[i].kind !== 'text') continue
          const msgRef = messages[i] as TextMessage
          const tcIdx = msgRef.toolCalls.findIndex(tc => tc.toolUseId === pd.tool_use_id)
          if (tcIdx >= 0) {
            const updated = [...msgRef.toolCalls]
            updated[tcIdx] = {
              ...updated[tcIdx],
              status: 'error' as const,
              result: `Permission denied: ${pd.message}`,
            }
            messages[i] = { ...msgRef, toolCalls: updated } as TextMessage
            break
          }
        }
      }
      // init, status, compact_boundary are silently ignored during replay
    } else if (raw.type === 'result') {
      const resultSubtype = (raw as Record<string, unknown>).subtype as string | undefined
      if (resultSubtype === 'error') {
        const errorMsg = raw as ResultErrorPayload
        const errorText = errorMsg.errors.join('\n') || 'Agent error'
        const isAborted = /aborted|cancelled|canceled/i.test(errorText)
        if (isAborted) {
          const lastMsg = messages[messages.length - 1]
          if (lastMsg?.kind === 'text' && lastMsg.phase === 'streaming') {
            messages[messages.length - 1] = { ...lastMsg, phase: 'complete' }
          }
          messages.push({
            kind: 'stopped',
            id: `stop-${Date.now()}`,
            role: 'assistant',
            phase: 'stopped',
            textContent: '我的思考被用户停止了',
            createdAt: Date.now(),
          })
        } else {
          messages.push({
            kind: 'text',
            id: `error-${Date.now()}`,
            role: 'assistant',
            phase: 'error',
            textContent: errorText,
            content: [],
            toolCalls: [],
            createdAt: Date.now(),
          })
        }
      }
      // success subtype doesn't add a displayable message
    }
    // stream_event messages are not persisted in session history — skip
  }

  return messages
}

// ─── Store ─────────────────────────────────────────────────────────────

export const useAgentStore = create<AgentStore>((set, get) => {
  const store: StoreApi = { set, get }

  return {
    context: 'editor',
    slots: { editor: emptySlot(), ask: emptySlot() },
    isResumingSession: false,
    sessionList: [],
    sessionSlots: {},
    activeWorkspacePath: null,
    workspaceDigest: null,
    workspaceDigestLoading: false,
    activeSessionId: null,
    sessionOutputs: null,
    sessionOutputsLoading: false,

    // ─── State Machine ──────────────────────────────────────────────────

    dispatchAgentEvent(event: AgentEvent, eventContext?: AgentContext) {
      const ctx = eventContext || get().context
      set((state) => {
        const slot = state.slots[ctx]
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

        return updateSlot(state, ctx, slotUpdates)
      })
    },

    // ─── Core Reducer ───────────────────────────────────────────────────

    processIPCMessage(msg: AgentIPCMessage & { context?: AgentContext; sessionId?: string }, options?: { isReplay?: boolean }) {
      const isReplay = options?.isReplay ?? false
      const ctx = msg.context || get().context

      // Convert legacy session_id field (some SDK events use this key)
      const eventSessionId = ((msg as Record<string, unknown>).sessionId as string)
        || ((msg as Record<string, unknown>).session_id as string)
        || undefined
      const activeSessionId = get().activeSessionId

      // ── Parallel streaming: route background session events ──────────
      // When a non-active session is still running in the background,
      // temporarily swap its saved slot into slots.editor so that all
      // handler functions (which write via updateSlot → slots[ctx])
      // operate on the correct session's state. After processing, save
      // the updated slot back to sessionSlots and restore the active slot.
      if (eventSessionId && activeSessionId && eventSessionId !== activeSessionId && !isReplay) {
        const backgroundSlot = get().sessionSlots[eventSessionId]
        if (!backgroundSlot) return // No cached slot — nothing to update

        // Swap: save active slot, pull background slot into editor
        set(state => {
          const activeSlot = state.slots.editor
          return {
            sessionSlots: { ...state.sessionSlots, [activeSessionId]: activeSlot },
            slots: { ...state.slots, editor: backgroundSlot },
          }
        })

        // Process event — handlers write to slots.editor (now the background slot)
        switch (msg.type) {
          case 'system':
            handleSystemMessage(store, ctx, msg)
            break
          case 'assistant':
            handleAssistantMessage(store, ctx, msg)
            break
          case 'stream_event':
            handleStreamEventMessage(store, ctx, msg, false)
            break
          case 'user':
            handleUserMessage(store, ctx, msg, false)
            break
          case 'result':
            handleResultMessage(store, ctx, msg)
            break
        }

        // Restore: save updated background slot, pull active slot back.
        // Update pagination offsets so that new messages streamed in the
        // background are accounted for — without this, `_sdkLoadOffset`
        // would remain stale and loadMore would re-fetch already-displayed
        // messages, causing duplicates.
        set(state => {
          const updatedBackground = state.slots.editor
          const newCount = updatedBackground.messages.length
          const adjustedSlot: typeof updatedBackground = {
            ...updatedBackground,
            _sdkLoadOffset: Math.max(updatedBackground._sdkLoadOffset ?? 0, newCount),
            _sdkLoadedCount: Math.max(updatedBackground._sdkLoadedCount ?? 0, newCount),
          }
          const restoredActive = state.sessionSlots[activeSessionId]
          const nextSessionSlots = { ...state.sessionSlots }
          nextSessionSlots[eventSessionId] = adjustedSlot
          if (restoredActive) {
            return {
              sessionSlots: nextSessionSlots,
              slots: { ...state.slots, editor: restoredActive },
            }
          }
          return { sessionSlots: nextSessionSlots }
        })

        return
      }

      // ── Active session / replay processing ───────────────────────────
      switch (msg.type) {
        case 'system':
          handleSystemMessage(store, ctx, msg)
          return
        case 'assistant':
          handleAssistantMessage(store, ctx, msg)
          return
        case 'stream_event':
          handleStreamEventMessage(store, ctx, msg, isReplay)
          return
        case 'user':
          handleUserMessage(store, ctx, msg, isReplay)
          return
        case 'result':
          handleResultMessage(store, ctx, msg)
          return
        default:
          return
      }
    },

    // ─── Interaction Handlers ─────────────────────────────────────────────

    handlePermissionRequest(req: PermissionRequestIPC) {
      // Drop stale permission requests belonging to a different session
      const activeSessionId = get().activeSessionId
      if (activeSessionId && req.sessionId && req.sessionId !== activeSessionId) {
        return
      }
      const ctx = (req.context as AgentContext) || get().context
      set((state) => {
        const slot = state.slots[ctx]
        if (slot.permissionRequest) {
          return updateSlot(state, ctx, { permissionQueue: [...slot.permissionQueue, req] })
        }
        return updateSlot(state, ctx, { permissionRequest: req })
      })
    },

    handlePermissionResponse(requestId: string, behavior: 'allow' | 'deny') {
      set((state) => {
        for (const ctx of ['editor', 'ask'] as AgentContext[]) {
          const slot = state.slots[ctx]
          if (slot.permissionRequest?.id === requestId) {
            const next = slot.permissionQueue[0] ?? null
            const rest = slot.permissionQueue.slice(1)
            return updateSlot(state, ctx, { permissionRequest: next, permissionQueue: rest })
          }
        }
        return {}
      })
    },

    handleAskUserRequest(req: AskUserRequestIPC) {
      // Drop stale AskUser requests belonging to a different session
      const activeSessionId = get().activeSessionId
      if (activeSessionId && req.sessionId && req.sessionId !== activeSessionId) {
        return
      }
      const ctx = (req.context as AgentContext) || get().context
      set((state) => {
        const slot = state.slots[ctx]
        if (slot.askUserRequest) {
          return updateSlot(state, ctx, { askUserQueue: [...slot.askUserQueue, req] })
        }
        return updateSlot(state, ctx, { askUserRequest: req })
      })
      get().dispatchAgentEvent({ type: 'ASK_USER_REQUEST' }, ctx)
    },

    handleAskUserResponse(requestId: string, answer: string) {
      set((state) => {
        let ctx: AgentContext = state.context
        if (state.slots.ask.askUserRequest?.id === requestId) ctx = 'ask'
        else if (state.slots.editor.askUserRequest?.id === requestId) ctx = 'editor'

        const s = state.slots[ctx]
        const next = s.askUserQueue[0] ?? null
        const rest = s.askUserQueue.slice(1)
        return updateSlot(state, ctx, {
          messages: [...s.messages, { kind: 'user' as const, id: `user-answer-${Date.now()}`, role: 'user', textContent: answer, createdAt: Date.now() }],
          askUserRequest: next, askUserQueue: rest,
        })
      })
    },

    handleAskUserTimeout(requestId: string) {
      set((state) => {
        let ctx: AgentContext = state.context
        if (state.slots.ask.askUserRequest?.id === requestId) ctx = 'ask'
        else if (state.slots.editor.askUserRequest?.id === requestId) ctx = 'editor'

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
        for (const ctx of ['editor', 'ask'] as AgentContext[]) {
          const slot = state.slots[ctx]
          if (slot.permissionRequest?.id === requestId) {
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
        return {}
      })
    },

    handleSkillOutput(skillState: SkillOutputState) {
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
      set({ activeSessionId: sessionId, sessionOutputs: null, sessionOutputsLoading: !!sessionId })
      // Trigger async load in the component via the loading flag
    },

    setSessionOutputs(outputs) {
      set({ sessionOutputs: outputs, sessionOutputsLoading: false })
    },

    // ─── Session List Protocol (single write path) ─────────────────────

    dispatchSessionList(action: SessionListAction) {
      set(state => ({ sessionList: sessionListReducer(state.sessionList, action) }))
    },

    // ─── Session Slot Isolation ────────────────────────────────────────

    ensureSessionSlot(sessionId: string) {
      set((state) => {
        if (state.sessionSlots[sessionId]) return {}
        return {
          sessionSlots: { ...state.sessionSlots, [sessionId]: emptySlot() },
        }
      })
    },

    switchToSession(sessionId: string) {
      const state = get()
      // Same session — nothing to do. Skip to avoid resetting sessionOutputsLoading
      // which would leave the OverviewPanel stuck in loading state.
      if (state.activeSessionId === sessionId) return

      // ── Parallel streaming: do NOT abort the current session. ──────────
      // Background sessions keep running; their events are routed to
      // sessionSlots via processIPCMessage's swap mechanism. The active
      // slot is saved to sessionSlots (for the running session to pick up
      // later) and restored when the user switches back.

      // Empty sessionId: reset editor to a clean slate (e.g. after session
      // deletion). Do not touch sessionSlots — the caller is responsible for
      // cleaning up the deleted session's cached slot.
      if (!sessionId) {
        set((state) => {
          const cleanSlot: ContextSlot = {
            ...emptySlot(),
            workspacePath: state.slots.editor.workspacePath || state.activeWorkspacePath,
          }
          return {
            activeSessionId: null,
            sessionOutputs: null,
            sessionOutputsLoading: false,
            slots: { ...state.slots, editor: cleanSlot },
          }
        })
        return
      }

      set((state) => {
        // Save current editor slot to previous session
        const prevSessionId = state.activeSessionId
        const nextSessionSlots = { ...state.sessionSlots }
        if (prevSessionId && prevSessionId !== sessionId) {
          // Defensive: only overwrite the saved slot if the editor actually has
          // state worth saving. If the editor slot is empty but a previously-saved
          // slot has messages, preserve the saved slot — prevents message loss
          // from empty-slot overwrites (e.g. after watchdog ABORT or failed resume).
          const editorHasContent = state.slots.editor.messages.length > 0
          const savedHasContent = nextSessionSlots[prevSessionId]?.messages?.length > 0
          if (editorHasContent || !savedHasContent) {
            nextSessionSlots[prevSessionId] = { ...state.slots.editor }
          }
        }

        // Load target session slot (or create empty, inheriting workspace path).
        // If sessionId is a real UUID (not a frontend-only new-* placeholder),
        // propagate it into currentSessionId so sendMessage can resume the SDK session.
        const existingSlot = nextSessionSlots[sessionId]
        const isRealSession = sessionId && !sessionId.startsWith('new-')
        const targetSlot = existingSlot
          ? {
              ...(isRealSession && !existingSlot.currentSessionId
                  ? { ...existingSlot, currentSessionId: sessionId }
                  : existingSlot),
              // Restore SDK pagination state; fall back for legacy slots
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

        return {
          activeSessionId: sessionId,
          sessionSlots: nextSessionSlots,
          sessionOutputs: null,
          sessionOutputsLoading: true,
          slots: { ...state.slots, editor: targetSlot },
        }
      })

      // If the target slot needs SDK load (no cached messages), kick off the load.
      // This unifies session-switch + load into a single code path, so both
      // handleSessionSelect and resumeSession get the same behavior.
      const editorSlot = get().slots.editor
      if (editorSlot._needsSdkLoad && editorSlot.currentSessionId === sessionId) {
        set({ isResumingSession: true })
        get().loadInitialSessionMessages(sessionId).finally(() => {
          if (get().activeSessionId === sessionId) {
            set({ isResumingSession: false })
          }
        }).catch((err) => {
          console.error('[AgentStore] switchToSession: loadInitialSessionMessages failed:', err)
        })
      }
    },

    // ─── SDK Paginated Message Loading ──────────────────────────────────

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
        // Request limit+1 to get a definitive hasMore signal:
        // if limit+1 messages come back, there are more beyond the page.
        const { messages: rawMessages } = await window.api.agent.loadSessionMessagesPaginated(
          sessionId,
          INITIAL_LIMIT + 1,
          0
        )
        const hasMore = rawMessages.length > INITIAL_LIMIT
        // Truncate the extra sentinel message so we only display limit messages.
        const messages = hasMore ? rawMessages.slice(0, INITIAL_LIMIT) : rawMessages
        const loadedCount = messages.length

        // Guard: discard results if the user switched to a different session
        // while the fetch was in flight.
        if (get().activeSessionId !== sessionId) {
          set((state) => ({
            sessionSlots: {
              ...state.sessionSlots,
              [sessionId]: { ...state.sessionSlots[sessionId], _isLoadingMoreMessages: false },
            },
          }))
          return
        }

        // Clear the editor slot and replay messages
        set((state) => {
          const curSlot = state.slots.editor
          const cleared: ContextSlot = {
            ...emptySlot(),
            workspacePath: curSlot.workspacePath || state.activeWorkspacePath,
            currentSessionId: sessionId,
            _needsSdkLoad: false,
            _sdkLoadedCount: loadedCount,
            _sdkLoadOffset: loadedCount,
            _isLoadingMoreMessages: true,
          }
          return {
            slots: { ...state.slots, editor: cleared },
            sessionSlots: { ...state.sessionSlots, [sessionId]: cleared },
          }
        })

        // Replay each message into the editor slot
        for (const msg of messages) {
          get().processIPCMessage(msg as AgentIPCMessage & { context?: AgentContext; sessionId?: string }, { isReplay: true })
        }

        // Persist the loaded messages and finalize slot state
        set((state) => {
          const editorSlot = state.slots.editor
          const finalSlot: ContextSlot = {
            ...editorSlot,
            _needsSdkLoad: hasMore,
            _sdkLoadedCount: loadedCount,
            _sdkLoadOffset: loadedCount,
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
        // Request limit+1 to get a definitive hasMore signal.
        const { messages: olderRawMessages } = await window.api.agent.loadSessionMessagesPaginated(
          sessionId,
          LOAD_MORE_LIMIT + 1,
          nextOffset
        )
        const hasMore = olderRawMessages.length > LOAD_MORE_LIMIT
        // Truncate the extra sentinel message so we only display limit messages.
        const olderMessages = hasMore ? olderRawMessages.slice(0, LOAD_MORE_LIMIT) : olderRawMessages
        const loadedCount = olderMessages.length

        // Build older messages into a local array without touching the editor
        // slot.  The editor slot stays intact so any streaming IPC events that
        // arrive during this load are preserved — no gap where messages could
        // be lost.
        const olderBuiltMessages = buildReplayedMessages(olderMessages)

        const newTotal = slot._sdkLoadedCount + loadedCount
        const newOffset = nextOffset + loadedCount

        // One atomic setState: prepend older messages before the CURRENT editor
        // messages (read fresh inside the functional updater so any IPC events
        // that arrived during the fetch are included).
        set((state) => {
          const editorSlot = state.slots.editor
          const currentMessages = editorSlot.messages

          const updatedEditorSlot: ContextSlot = {
            ...editorSlot,
            messages: [...olderBuiltMessages, ...currentMessages],
            _sdkLoadOffset: newOffset,
            _sdkLoadedCount: newTotal,
            _needsSdkLoad: hasMore,
            _isLoadingMoreMessages: false,
          }
          return {
            slots: { ...state.slots, editor: updatedEditorSlot },
            sessionSlots: {
              ...state.sessionSlots,
              [sessionId]: updatedEditorSlot,
            },
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
      const sessionId = get().activeSessionId
      if (!sessionId || sessionId.startsWith('new-')) return
      try {
        await window.api.agent.renameSession(sessionId, title)
        set((state) => ({
          sessionList: state.sessionList.map((s) =>
            s.id === sessionId ? { ...s, title } : s
          ),
        }))
      } catch (err) {
        console.error('[AgentStore] renameCurrentSession failed:', err)
      }
    },
  }
})

// HMR: persist store across module reloads so getState() always has actions
if (import.meta.hot) {
  import.meta.hot.dispose((data) => {
    data.state = useAgentStore.getState()
  })
  if (import.meta.hot.data?.state) {
    useAgentStore.setState(import.meta.hot.data.state, true)
  }
}
