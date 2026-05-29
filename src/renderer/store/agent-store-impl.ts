import { create } from 'zustand'
import type { AgentStore, ContextSlot } from './agent-store'
import { emptySlot } from './agent-store'
import type {
  AgentContext,
  AgentIPCMessage,
  AgentState,
  AgentEvent,
  ConversationMessage,
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

function ensureAccumulator(messageId: string, slot: ContextSlot): StreamingAccumulator {
  if (slot._acc && slot._acc.messageId === messageId) return slot._acc
  return {
    messageId,
    text: '',
    toolUseBlocks: new Map(),
    thinkingText: '',
  }
}

function commitAccumulator(acc: StreamingAccumulator, slot: ContextSlot, content: ContentBlock[], phase: ConversationMessage['phase']): Partial<ContextSlot> {
  const msgIdx = slot.messages.findIndex((m) => m.id === acc.messageId)
  if (msgIdx < 0) return { _acc: null }

  const textContent = acc.text
  const toolCalls: ToolCallState[] = []

  for (const [id, block] of acc.toolUseBlocks) {
    let input: Record<string, unknown> = {}
    try { input = JSON.parse(block.inputJson) } catch {}
    toolCalls.push({
      toolUseId: id,
      toolName: block.name,
      input,
      status: 'running',
    })
  }

  const hasToolUse = content.some((b) => b.type === 'tool_use')
  const hasText = content.some((b) => b.type === 'text')

  const updatedMessages = [...slot.messages]
  updatedMessages[msgIdx] = {
    ...updatedMessages[msgIdx],
    phase,
    textContent: hasText ? (content.find(isTextBlock))?.text || textContent : textContent,
    content: content.length > 0 ? content : updatedMessages[msgIdx].content,
    toolCalls: hasToolUse
      ? content
          .filter(isToolUseBlock)
          .map((tu) => {
            let input: Record<string, unknown> = {}
            if (tu.input && typeof tu.input === 'object') input = tu.input
            return {
              toolUseId: tu.id,
              toolName: tu.name,
              input,
              status: 'running' as const,
            }
          })
      : toolCalls,
  }

  return { messages: updatedMessages, _acc: null }
}

// ─── Artifact Extraction ────────────────────────────────────────────────

function extractSkillOutputContent(text: string): string | null {
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

function transition(current: AgentState, event: AgentEvent): AgentState {
  const allowed = TRANSITIONS[current]?.[event.type]
  if (!allowed) {
    console.warn(`[AgentFSM] Invalid transition: ${current} + ${event.type}`)
    return current
  }
  return allowed
}

// ─── Store ─────────────────────────────────────────────────────────────

export const useAgentStore = create<AgentStore>((set, get) => ({
  context: 'editor',
  slots: { editor: emptySlot(), ask: emptySlot() },
  isResumingSession: false,
  sessionList: [],

  // ─── State Machine ──────────────────────────────────────────────────

  dispatchAgentEvent(event: AgentEvent, eventContext?: AgentContext) {
    const ctx = eventContext || get().context
    set((state) => {
      const slot = state.slots[ctx]
      const next = transition(slot.agentState, event)
      const slotUpdates: Partial<ContextSlot> = { agentState: next }

      // On leaving 'thinking', remove status indicator messages
      if (slot.agentState === 'thinking' && next !== 'thinking') {
        slotUpdates.messages = slot.messages.filter(
          (m) => !(m.phase === 'streaming' && m.role === 'system')
        )
      }

      // On result success/error
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
          m.phase !== 'complete' && m.phase !== 'error' ? { ...m, phase: 'complete' as const } : m
        )
        const skillId = slot.activeSkillId
        if (skillId) {
          for (let i = 0; i < msgs.length; i++) {
            if (msgs[i].skillMeta?.id === skillId) {
              msgs[i] = { ...msgs[i], skillMeta: { ...msgs[i].skillMeta!, status: 'completed' } }
              break
            }
          }
        }
        const finalMsgs = [...msgs]
        for (let i = msgs.length - 1; i >= 0; i--) {
          const artifact = extractArtifactFromMessage(msgs[i])
          if (artifact) {
            finalMsgs.push({
              id: `artifact-${Date.now()}-${i}`,
              role: 'assistant',
              phase: 'complete',
              textContent: '',
              content: [],
              toolCalls: [],
              artifact,
              createdAt: Date.now(),
            })
          }
        }
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
        const msgs = slot.messages.map((m) =>
          m.phase !== 'complete' && m.phase !== 'stopped' ? { ...m, phase: 'error' as const } : m
        )
        const skillId = slot.activeSkillId
        if (skillId) {
          for (let i = 0; i < msgs.length; i++) {
            if (msgs[i].skillMeta?.id === skillId) {
              msgs[i] = { ...msgs[i], skillMeta: { ...msgs[i].skillMeta!, status: 'error' } }
              break
            }
          }
        }
        slotUpdates.messages = msgs
      }

      return updateSlot(state, ctx, slotUpdates)
    })
  },

  // ─── Core Reducer ───────────────────────────────────────────────────

  processIPCMessage(msg: AgentIPCMessage & { context?: AgentContext }, options?: { isReplay?: boolean }) {
    const isReplay = options?.isReplay ?? false
    const ctx = msg.context || get().context

    switch (msg.type) {
      // ── system: init ──
      case 'system': {
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
            const targetMsg = slot.messages.find((m) =>
              m.toolCalls.some((tc) => tc.toolUseId === pdMsg.tool_use_id)
            )
            if (targetMsg) {
              const msgs = [...slot.messages]
              const idx = msgs.indexOf(targetMsg)
              msgs[idx] = {
                ...msgs[idx],
                toolCalls: msgs[idx].toolCalls.map((tc) =>
                  tc.toolUseId === pdMsg.tool_use_id
                    ? { ...tc, status: 'error' as const, result: `Permission denied: ${pdMsg.message}` }
                    : tc
                ),
              }
              return updateSlot(state, ctx, { messages: msgs })
            }
            return {}
          })
          return
        }
        return
      }

      // ── assistant (commit) ──
      case 'assistant': {
        const assistantMsg = msg as AssistantPayload
        const content = assistantMsg.message.content
        const slot = get().slots[ctx]

        if (!slot._firstContentSeen) {
          set((state) => updateSlot(state, ctx, { _firstContentSeen: true }))
          get().dispatchAgentEvent({ type: 'FIRST_CONTENT' }, ctx)
        }

        set((state) => {
          const s = state.slots[ctx]
          // If accumulator exists, commit it
          if (s._acc) {
            const commitUpdates = commitAccumulator(s._acc, s, content, 'complete')
            return updateSlot(state, ctx, commitUpdates)
          }

          const msgId = assistantMsg.uuid || `assistant-${Date.now()}`
          const phase: ConversationMessage['phase'] = 'complete'

          const textContent = content
            .filter(isTextBlock)
            .map((b) => b.text)
            .join('')

          const toolCalls: ToolCallState[] = content
            .filter(isToolUseBlock)
            .map((tu) => {
              let input: Record<string, unknown> = {}
              if (tu.input && typeof tu.input === 'object') input = tu.input
              return {
                toolUseId: tu.id || `tu-${Date.now()}`,
                toolName: tu.name || 'unknown',
                input,
                status: 'running' as const,
              }
            })

          const visibleToolCalls = toolCalls.filter((tc) => tc.toolName !== 'AskUserQuestion')

          const newMsg: ConversationMessage = {
            id: msgId,
            role: 'assistant',
            phase,
            textContent,
            content,
            toolCalls: visibleToolCalls,
            createdAt: Date.now(),
          }

          return updateSlot(state, ctx, { messages: [...s.messages, newMsg] })
        })
        return
      }

      // ── stream_event (delta) ──
      case 'stream_event': {
        if (isReplay) return

        const streamMsg = msg as StreamEventPayloadIPC
        const event = streamMsg.event

        switch (event.type) {
          case 'content_block_delta': {
            const deltaEvent = event as StreamContentBlockDelta
            const delta = deltaEvent.delta

            if (delta.type === 'text_delta') {
              const textDelta = delta as TextDelta
              set((state) => {
                const s = state.slots[ctx]
                let acc = s._acc
                if (!acc) {
                  let msgId = `assistant-${Date.now()}`
                  const lastMsg = s.messages[s.messages.length - 1]
                  if (lastMsg?.role === 'assistant' && lastMsg.phase !== 'complete') {
                    msgId = lastMsg.id
                  } else {
                    const newMsg: ConversationMessage = {
                      id: msgId,
                      role: 'assistant',
                      phase: 'streaming',
                      textContent: '',
                      content: [],
                      toolCalls: [],
                      createdAt: Date.now(),
                    }
                    const msgs = [...s.messages.filter((m) => !(m.phase === 'streaming' && m.role === 'system')), newMsg]
                    const newAcc = ensureAccumulator(msgId, s)
                    return updateSlot(state, ctx, { messages: msgs, _acc: newAcc, isStreaming: true })
                  }
                  acc = ensureAccumulator(msgId, s)
                }

                acc.text += textDelta.text

                const msgs = [...s.messages]
                const idx = msgs.findIndex((m) => m.id === acc!.messageId)
                if (idx >= 0) {
                  msgs[idx] = { ...msgs[idx], textContent: acc.text, phase: 'streaming' }
                }

                const firstSeen = s._firstContentSeen
                if (!firstSeen) {
                  setTimeout(() => get().dispatchAgentEvent({ type: 'FIRST_CONTENT' }, ctx), 0)
                }

                return updateSlot(state, ctx, { messages: msgs, _acc: acc, _firstContentSeen: true })
              })
            }

            if (delta.type === 'input_json_delta') {
              const jsonDelta = delta as InputJsonDelta
              set((state) => {
                const s = state.slots[ctx]
                const acc = s._acc
                if (!acc) return {}
                const blocks = Array.from(acc.toolUseBlocks.entries())
                if (blocks.length > 0) {
                  const [lastId, lastBlock] = blocks[blocks.length - 1]
                  acc.toolUseBlocks.set(lastId, {
                    ...lastBlock,
                    inputJson: lastBlock.inputJson + jsonDelta.partial_json,
                  })

                  const msgs = [...s.messages]
                  const idx = msgs.findIndex((m) => m.id === acc.messageId)
                  if (idx >= 0) {
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
            return
          }

          case 'content_block_start': {
            const startEvent = event as StreamContentBlockStart
            const block = startEvent.content_block

            set((state) => {
              const s = state.slots[ctx]
              let acc = s._acc
              if (!acc) {
                let msgId = `assistant-${Date.now()}`
                const lastMsg = s.messages[s.messages.length - 1]
                if (lastMsg?.role === 'assistant' && lastMsg.phase !== 'complete') {
                  msgId = lastMsg.id
                } else {
                  const newMsg: ConversationMessage = {
                    id: msgId,
                    role: 'assistant',
                    phase: 'tool_calling',
                    textContent: '',
                    content: [],
                    toolCalls: [],
                    createdAt: Date.now(),
                  }
                  const msgs = [...s.messages.filter((m) => !(m.phase === 'streaming' && m.role === 'system')), newMsg]
                  const newAcc = ensureAccumulator(msgId, s)
                  return updateSlot(state, ctx, { messages: msgs, _acc: newAcc, isStreaming: true })
                }
                acc = ensureAccumulator(msgId, s)
              }

              if (block.type === 'tool_use') {
                const name = block.name || 'unknown'
                acc.toolUseBlocks.set(block.id, { name, inputJson: '' })

                const newToolCall: ToolCallState = {
                  toolUseId: block.id,
                  toolName: name,
                  input: {},
                  inputJsonPartial: '',
                  status: 'pending',
                }

                const msgs = [...s.messages]
                const idx = msgs.findIndex((m) => m.id === acc!.messageId)
                if (idx >= 0) {
                  const existing = msgs[idx].toolCalls.some((tc) => tc.toolUseId === block.id)
                  if (!existing) {
                    msgs[idx] = {
                      ...msgs[idx],
                      toolCalls: [...msgs[idx].toolCalls, newToolCall],
                      phase: 'tool_calling',
                    }
                  }
                }
                return updateSlot(state, ctx, { messages: msgs, _acc: acc })
              }
              return {}
            })
            return
          }

          case 'content_block_stop': {
            set((state) => {
              const s = state.slots[ctx]
              const acc = s._acc
              if (!acc) return {}
              const msgs = [...s.messages]
              const idx = msgs.findIndex((m) => m.id === acc.messageId)
              if (idx < 0) return {}

              const updatedToolCalls = msgs[idx].toolCalls.map((tc) => {
                const block = acc.toolUseBlocks.get(tc.toolUseId)
                if (!block) return tc
                let input: Record<string, unknown> = {}
                try { input = JSON.parse(block.inputJson) } catch {}
                return {
                  ...tc,
                  input,
                  inputJsonPartial: undefined,
                  status: 'running' as const,
                }
              })
              msgs[idx] = { ...msgs[idx], toolCalls: updatedToolCalls }

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
            return
          }

          default:
            return
        }
      }

      // ── user (tool_result or text echo) ──
      case 'user': {
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
                const tcIdx = msgs[i].toolCalls.findIndex((tc) => tc.toolUseId === toolUseId)
                if (tcIdx >= 0) {
                  const updatedToolCalls = [...msgs[i].toolCalls]
                  updatedToolCalls[tcIdx] = {
                    ...updatedToolCalls[tcIdx],
                    result: resultContent,
                    status: isError ? 'error' : 'completed',
                  }
                  msgs[i] = { ...msgs[i], toolCalls: updatedToolCalls }
                  changed = true
                  break
                }
              }
            }
          }

          if (isReplay && textBlocks.length > 0) {
            const text = textBlocks.map((b) => b.text).join('')
            if (text && !msgs.some((m) => m.role === 'user' && m.textContent === text)) {
              msgs.push({
                id: userMsg.uuid || `user-${Date.now()}`,
                role: 'user',
                phase: 'complete',
                textContent: text,
                content,
                toolCalls: [],
                createdAt: Date.now(),
              })
              changed = true
            }
          }

          return changed ? updateSlot(state, ctx, { messages: msgs }) : {}
        })
        return
      }

      // ── result (success or error) ──
      case 'result': {
        if (msg.subtype === 'success') {
          const resultMsg = msg as ResultSuccessPayload
          set((state) => updateSlot(state, ctx, { usageInfo: resultMsg.usage }))
          get().dispatchAgentEvent({ type: 'RESULT_SUCCESS' }, ctx)
        } else {
          const errorMsg = msg as ResultErrorPayload
          const errorText = errorMsg.errors.join('\n') || 'Agent error'
          const isAborted = /aborted|cancelled|canceled/i.test(errorText)

          set((state) => {
            const s = state.slots[ctx]
            const lastMsg = s.messages[s.messages.length - 1]
            if (isAborted) {
              // User-initiated stop: replace error with friendly message
              const stopNote = {
                id: `stop-${Date.now()}`,
                role: 'assistant' as const,
                phase: 'stopped' as const,
                textContent: '我的思考被用户停止了',
                content: [],
                toolCalls: [],
                createdAt: Date.now(),
              }
              const msgs = lastMsg?.phase === 'streaming'
                ? [...s.messages.slice(0, -1), { ...lastMsg, phase: 'complete' as const }, stopNote]
                : [...s.messages, stopNote]
              return updateSlot(state, ctx, {
                messages: msgs,
                usageInfo: errorMsg.usage,
              })
            }
            return updateSlot(state, ctx, {
              messages: [...s.messages, {
                id: `error-${Date.now()}`,
                role: 'assistant' as const,
                phase: 'error' as const,
                textContent: errorText,
                content: [],
                toolCalls: [],
                createdAt: Date.now(),
              }],
              usageInfo: errorMsg.usage,
            })
          })
          get().dispatchAgentEvent({ type: 'RESULT_ERROR' }, ctx)
        }
        return
      }

      default:
        return
    }
  },

  // ─── Interaction Handlers ─────────────────────────────────────────────

  handlePermissionRequest(req: PermissionRequestIPC) {
    const ctx = (req.context as AgentContext) || get().context
    set((state) => {
      const slot = state.slots[ctx]
      // If a permission dialog is already showing, queue this request
      if (slot.permissionRequest) {
        return updateSlot(state, ctx, { permissionQueue: [...slot.permissionQueue, req] })
      }
      return updateSlot(state, ctx, { permissionRequest: req })
    })
  },

  handlePermissionResponse(requestId: string, behavior: 'allow' | 'deny') {
    // Clear permission from whichever slot has it, then show next in queue
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
        messages: [...s.messages, {
          id: `user-answer-${Date.now()}`,
          role: 'user',
          phase: 'complete',
          textContent: answer,
          content: [{ type: 'text', text: answer }],
          toolCalls: [],
          createdAt: Date.now(),
        }],
        askUserRequest: next,
        askUserQueue: rest,
      })
    })
  },

  handleAskUserTimeout(requestId: string) {
    const current = get()
    let ctx: AgentContext = current.context
    if (current.slots.ask.askUserRequest?.id === requestId) ctx = 'ask'
    else if (current.slots.editor.askUserRequest?.id === requestId) ctx = 'editor'

    set((state) => {
      const s = state.slots[ctx]
      const next = s.askUserQueue[0] ?? null
      const rest = s.askUserQueue.slice(1)
      return updateSlot(state, ctx, {
        messages: [...s.messages, {
          id: `timeout-${Date.now()}`,
          role: 'system',
          phase: 'complete',
          textContent: '☕ 等了很久没有回应，我先休息一下，有事随时沟通',
          content: [{ type: 'text', text: '☕ 等了很久没有回应，我先休息一下，有事随时沟通' }],
          toolCalls: [],
          createdAt: Date.now(),
        }],
        askUserRequest: next,
        askUserQueue: rest,
      })
    })

    get().dispatchAgentEvent({ type: 'ASK_USER_TIMEOUT' }, ctx)
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
}))

// HMR: persist store across module reloads so getState() always has actions
if (import.meta.hot) {
  import.meta.hot.dispose((data) => {
    data.state = useAgentStore.getState()
  })
  if (import.meta.hot.data?.state) {
    useAgentStore.setState(import.meta.hot.data.state, true)
  }
}