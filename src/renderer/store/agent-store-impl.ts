import { create } from 'zustand'
import type {
  AgentStore,
} from './agent-store'
import type {
  AgentIPCMessage,
  AgentState,
  AgentEvent,
  ConversationMessage,
  ContentBlock,
  ToolCallState,
  ArtifactData,
  ArtifactFileType,
  UsageInfo,
  PermissionRequestIPC,
  AskUserRequestIPC,
  SdkSessionInfo,
  StreamingAccumulator,
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
import { AGENT_TRANSITIONS as TRANSITIONS } from '../../shared/types'

// ─── Accumulator helpers ──────────────────────────────────────────────
// _acc and _firstContentSeen live in Zustand state for single source of truth.
// These helpers read/write them via get()/set().

function ensureAccumulator(messageId: string, state: AgentStore): StreamingAccumulator {
  if (state._acc && state._acc.messageId === messageId) return state._acc
  return {
    messageId,
    text: '',
    toolUseBlocks: new Map(),
    thinkingText: '',
  }
}

function commitAccumulator(acc: StreamingAccumulator, state: AgentStore, content: ContentBlock[], phase: ConversationMessage['phase']): Partial<AgentStore> {
  const msgIdx = state.messages.findIndex((m) => m.id === acc.messageId)
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

  // If assistant msg has content blocks, use those as canonical
  const hasToolUse = content.some((b) => b.type === 'tool_use')
  const hasText = content.some((b) => b.type === 'text')

  const updatedMessages = [...state.messages]
  updatedMessages[msgIdx] = {
    ...updatedMessages[msgIdx],
    phase,
    textContent: hasText ? (content.find((b) => b.type === 'text') as any)?.text || textContent : textContent,
    content: content.length > 0 ? content : updatedMessages[msgIdx].content,
    toolCalls: hasToolUse
      ? content
          .filter((b) => b.type === 'tool_use')
          .map((b) => {
            const tu = b as any
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
  // 1. skill-output code block in text — prioritize file extension from tool calls
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

  // 2. Write/Edit tool that produced a file
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
  // State
  messages: [],
  isStreaming: false,
  agentState: 'idle',
  currentSessionId: null,
  usageInfo: null,
  lastEditedFile: null,
  permissionRequest: null,
  askUserRequest: null,
  activeSkillId: null,
  sessionList: [],
  _acc: null,
  _firstContentSeen: false,

  // ─── State Machine ──────────────────────────────────────────────────

  dispatchAgentEvent(event: AgentEvent) {
    set((state) => {
      const next = transition(state.agentState, event)
      const updates: Partial<AgentStore> = { agentState: next }

      // On leaving 'thinking', remove status indicator messages
      if (state.agentState === 'thinking' && next !== 'thinking') {
        updates.messages = state.messages.filter(
          (m) => !(m.phase === 'streaming' && m.role === 'system')
        )
      }

      // On result success/error
      if (event.type === 'RESULT_SUCCESS') {
        updates.isStreaming = false
        updates._acc = null
        updates._firstContentSeen = false
        // Finalize any messages still in non-complete phase
        const msgs = (updates.messages || state.messages).map((m) =>
          m.phase !== 'complete' && m.phase !== 'error' ? { ...m, phase: 'complete' as const } : m
        )
        // Extract artifacts
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
        updates.messages = finalMsgs
      }

      if (event.type === 'RESULT_ERROR') {
        updates.isStreaming = false
        updates._acc = null
        updates._firstContentSeen = false
        const msgs = state.messages.map((m) =>
          m.phase !== 'complete' ? { ...m, phase: 'error' as const } : m
        )
        updates.messages = msgs
      }

      return updates
    })
  },

  // ─── Core Reducer ───────────────────────────────────────────────────

  processIPCMessage(msg: AgentIPCMessage, options?: { isReplay?: boolean }) {
    const isReplay = options?.isReplay ?? false
    const state = get()

    switch (msg.type) {
      // ── system: init ──
      case 'system': {
        if (msg.subtype === 'init') {
          const initMsg = msg as SystemInitPayload
          if (initMsg.session_id && !state.currentSessionId) {
            set({ currentSessionId: initMsg.session_id })
          }
          return
        }
        if (msg.subtype === 'status') {
          const statusMsg = msg as SystemStatusPayload
          if (statusMsg.status === 'compacting') {
            get().dispatchAgentEvent({ type: 'COMPACT_BOUNDARY' })
          } else if (statusMsg.status === 'requesting') {
            get().dispatchAgentEvent({ type: 'STATUS_REQUESTING' })
          }
          return
        }
        if (msg.subtype === 'compact_boundary') {
          get().dispatchAgentEvent({ type: 'COMPACT_BOUNDARY' })
          return
        }
        if (msg.subtype === 'permission_denied') {
          const pdMsg = msg as SystemPermissionDeniedPayload
          set((s) => {
            const targetMsg = s.messages.find((m) =>
              m.toolCalls.some((tc) => tc.toolUseId === pdMsg.tool_use_id)
            )
            if (targetMsg) {
              const msgs = [...s.messages]
              const idx = msgs.indexOf(targetMsg)
              msgs[idx] = {
                ...msgs[idx],
                toolCalls: msgs[idx].toolCalls.map((tc) =>
                  tc.toolUseId === pdMsg.tool_use_id
                    ? { ...tc, status: 'error' as const, result: `Permission denied: ${pdMsg.message}` }
                    : tc
                ),
              }
              return { messages: msgs }
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

        if (!state._firstContentSeen) {
          set({ _firstContentSeen: true })
          get().dispatchAgentEvent({ type: 'FIRST_CONTENT' })
        }

        set((s) => {
          // If accumulator exists, commit it
          if (s._acc) {
            const commitUpdates = commitAccumulator(s._acc, s, content, 'complete')
            return { ...commitUpdates }
          }

          // No accumulator — this is the first time we see this message
          const msgId = assistantMsg.uuid || `assistant-${Date.now()}`
          const phase: ConversationMessage['phase'] = isReplay ? 'complete' : 'complete'

          // Extract text and tool_use from content
          const textContent = content
            .filter((b) => b.type === 'text')
            .map((b) => (b as any).text || '')
            .join('')

          const toolCalls: ToolCallState[] = content
            .filter((b) => b.type === 'tool_use')
            .map((b) => {
              const tu = b as any
              let input: Record<string, unknown> = {}
              if (tu.input && typeof tu.input === 'object') input = tu.input
              return {
                toolUseId: tu.id || `tu-${Date.now()}`,
                toolName: tu.name || 'unknown',
                input,
                status: 'running' as const,
              }
            })

          // Skip AskUserQuestion tool calls from display
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

          return { messages: [...s.messages, newMsg] }
        })
        return
      }

      // ── stream_event (delta) ──
      case 'stream_event': {
        if (isReplay) return // Don't replay streaming deltas

        const streamMsg = msg as StreamEventPayloadIPC
        const event = streamMsg.event

        switch (event.type) {
          case 'content_block_delta': {
            const deltaEvent = event as StreamContentBlockDelta
            const delta = deltaEvent.delta

            if (delta.type === 'text_delta') {
              const textDelta = delta as TextDelta
              set((s) => {
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
                    // Create accumulator for next set() call
                    const newAcc = ensureAccumulator(msgId, s)
                    return { messages: msgs, _acc: newAcc }
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
                  setTimeout(() => get().dispatchAgentEvent({ type: 'FIRST_CONTENT' }), 0)
                }

                return { messages: msgs, _acc: acc, _firstContentSeen: true }
              })
            }

            if (delta.type === 'input_json_delta') {
              const jsonDelta = delta as InputJsonDelta
              set((s) => {
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
                  return { messages: msgs, _acc: acc }
                }
                return {}
              })
            }
            return
          }

          case 'content_block_start': {
            const startEvent = event as StreamContentBlockStart
            const block = startEvent.content_block

            set((s) => {
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
                  return { messages: msgs, _acc: newAcc }
                }
                acc = ensureAccumulator(msgId, s)
              }

              if (block.type === 'tool_use') {
                const tu = block as any
                acc.toolUseBlocks.set(tu.id, { name: tu.name, inputJson: '' })

                const newToolCall: ToolCallState = {
                  toolUseId: tu.id,
                  toolName: tu.name,
                  input: {},
                  inputJsonPartial: '',
                  status: 'pending',
                }

                const msgs = [...s.messages]
                const idx = msgs.findIndex((m) => m.id === acc!.messageId)
                if (idx >= 0) {
                  const existing = msgs[idx].toolCalls.some((tc) => tc.toolUseId === tu.id)
                  if (!existing) {
                    msgs[idx] = {
                      ...msgs[idx],
                      toolCalls: [...msgs[idx].toolCalls, newToolCall],
                      phase: 'tool_calling',
                    }
                  }
                }
                return { messages: msgs, _acc: acc }
              }
              return {}
            })
            return
          }

          case 'content_block_stop': {
            set((s) => {
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
                  return { messages: msgs, lastEditedFile: filePath, _acc: acc }
                }
              }
              return { messages: msgs, _acc: acc }
            })
            return
          }

          // message_start/delta/stop — structural events, ignore
          default:
            return
        }
      }

      // ── user (tool_result or text echo) ──
      case 'user': {
        const userMsg = msg as UserPayload
        const content = userMsg.message.content

        set((s) => {
          const toolResults = content.filter((b) => b.type === 'tool_result') as any[]
          const textBlocks = content.filter((b) => b.type === 'text') as any[]
          const msgs = [...s.messages]
          let changed = false

          // Update tool_call results
          if (toolResults.length > 0) {
            for (const tr of toolResults) {
              const toolUseId = tr.tool_use_id as string
              const resultContent = typeof tr.content === 'string'
                ? tr.content
                : Array.isArray(tr.content)
                  ? tr.content.map((c: any) => c.text || '').join('')
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

          // For replay: create user message bubble from text content
          if (isReplay && textBlocks.length > 0) {
            const text = textBlocks.map((b: any) => b.text || '').join('')
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

          return changed ? { messages: msgs } : {}
        })
        return
      }

      // ── result (success or error) ──
      case 'result': {
        if (msg.subtype === 'success') {
          const resultMsg = msg as ResultSuccessPayload
          set({
            usageInfo: resultMsg.usage,
          })
          get().dispatchAgentEvent({ type: 'RESULT_SUCCESS' })
        } else {
          const errorMsg = msg as ResultErrorPayload
          set((s) => ({
            messages: [...s.messages, {
              id: `error-${Date.now()}`,
              role: 'assistant',
              phase: 'error',
              textContent: errorMsg.errors.join('\n') || 'Agent error',
              content: [],
              toolCalls: [],
              createdAt: Date.now(),
            }],
            usageInfo: errorMsg.usage,
          }))
          get().dispatchAgentEvent({ type: 'RESULT_ERROR' })
        }
        return
      }

      default:
        return
    }
  },

  // ─── Interaction Handlers ─────────────────────────────────────────────

  handlePermissionRequest(req: PermissionRequestIPC) {
    set({ permissionRequest: req })
  },

  handlePermissionResponse(requestId: string, behavior: 'allow' | 'deny') {
    set({ permissionRequest: null })
  },

  handleAskUserRequest(req: AskUserRequestIPC) {
    set({
      askUserRequest: req,
    })
    get().dispatchAgentEvent({ type: 'ASK_USER_REQUEST' })
  },

  handleAskUserResponse(requestId: string, answer: string) {
    set((s) => ({
      messages: [...s.messages, {
        id: `user-answer-${Date.now()}`,
        role: 'user',
        phase: 'complete',
        textContent: answer,
        content: [{ type: 'text', text: answer }],
        toolCalls: [],
        createdAt: Date.now(),
      }],
      askUserRequest: null,
    }))
  },

  handleAskUserTimeout(requestId: string) {
    set((s) => ({
      messages: [...s.messages, {
        id: `timeout-${Date.now()}`,
        role: 'system',
        phase: 'complete',
        textContent: '⏱ 等待回答超时，Agent 已停止等待',
        content: [{ type: 'text', text: '⏱ 等待回答超时，Agent 已停止等待' }],
        toolCalls: [],
        createdAt: Date.now(),
      }],
      askUserRequest: null,
    }))
    get().dispatchAgentEvent({ type: 'ASK_USER_TIMEOUT' })
  },
}))