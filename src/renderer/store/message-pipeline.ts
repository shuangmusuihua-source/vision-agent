import type {
  AgentContext,
  AgentIPCMessage,
  AgentEvent,
  ConversationMessage,
  TextMessage,
  StoppedMessage,
  ContentBlock,
  ToolCallState,
  ArtifactData,
  ArtifactFileType,
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
  StreamMessageStart,
} from '../../shared/types'
import { ContextSlot } from './agent-store'
import { isTextBlock, isToolUseBlock, isToolResultBlock } from '../../shared/types'

// ─── Accumulator helpers ──────────────────────────────────────────────

export function ensureAccumulator(messageId: string, slot: ContextSlot): StreamingAccumulator {
  if (slot._acc && slot._acc.messageId === messageId) return slot._acc
  return { messageId, text: '', toolUseBlocks: new Map(), thinkingText: '' }
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

  const updatedMsg: TextMessage = {
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

  // Use slice-based immutable update instead of [...slot.messages] spread copy.
  // When updating the last element (common case for streaming), slice(0, -1) avoids
  // copying the trailing element and concat appends the new one — V8 optimizes this path.
  const lastIdx = slot.messages.length - 1
  const updatedMessages = msgIdx === lastIdx
    ? slot.messages.slice(0, -1).concat([updatedMsg])
    : (() => { const a = [...slot.messages]; a[msgIdx] = updatedMsg; return a })()

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

export function extractArtifactFromMessage(msg: ConversationMessage): ArtifactData | null {
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

// ─── Message reducer result ────────────────────────────────────────────

export interface ReductionResult {
  patch: Partial<ContextSlot>
  /** FSM events the store wrapper should dispatch after applying the patch. */
  events: AgentEvent[]
}

// ─── System message reducer ────────────────────────────────────────────

export function reduceSystemMessage(
  slot: ContextSlot,
  msg: AgentIPCMessage & { subtype?: string; session_id?: string; message?: string; tool_use_id?: string }
): { patch: Partial<ContextSlot>; events: AgentEvent[] } {
  if (msg.subtype === 'init') {
    const initMsg = msg as SystemInitPayload
    const patch: Partial<ContextSlot> = {}
    if (initMsg.session_id && !slot.currentSessionId) {
      patch.currentSessionId = initMsg.session_id
    }
    return { patch, events: [] }
  }
  if (msg.subtype === 'status') {
    const statusMsg = msg as SystemStatusPayload
    const events: AgentEvent[] = []
    if (statusMsg.status === 'compacting') {
      events.push({ type: 'COMPACT_BOUNDARY' })
    } else if (statusMsg.status === 'requesting') {
      events.push({ type: 'STATUS_REQUESTING' })
    }
    // If compacting finished with failure, inject a system message
    const patch: Partial<ContextSlot> = {}
    if (statusMsg.compact_result === 'failed') {
      const compactErrorNote: StoppedMessage = {
        kind: 'stopped', id: `compact-err-${Date.now()}`, role: 'assistant', phase: 'stopped',
        textContent: '⚠️ 上下文压缩失败，对话可能不完整', createdAt: Date.now(),
      }
      patch.messages = [...slot.messages, compactErrorNote]
    }
    return { patch, events }
  }
  if (msg.subtype === 'compact_boundary') {
    const boundaryMsg = msg as SystemCompactBoundaryPayload
    const patch: Partial<ContextSlot> = {}
    // Show compaction diagnostic info if available
    if (boundaryMsg.compact_metadata) {
      const meta = boundaryMsg.compact_metadata
      const preTokens = meta.pre_tokens ? `${Math.round(meta.pre_tokens / 1000)}k` : '?'
      const postTokens = meta.post_tokens ? `${Math.round(meta.post_tokens / 1000)}k` : '?'
      const compactInfo: StoppedMessage = {
        kind: 'stopped', id: `compact-${Date.now()}`, role: 'assistant', phase: 'stopped',
        textContent: `📦 上下文已压缩: ${preTokens} → ${postTokens} tokens`,
        createdAt: Date.now(),
      }
      patch.messages = [...slot.messages, compactInfo]
    }
    return { patch, events: [{ type: 'COMPACT_BOUNDARY' }] }
  }
  if (msg.subtype === 'permission_denied') {
    const pdMsg = msg as SystemPermissionDeniedPayload
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
      return { patch: { messages: msgs }, events: [] }
    }
    return { patch: {}, events: [] }
  }
  if (msg.subtype === 'task_notification') {
    return { patch: {}, events: [] }
  }
  return { patch: {}, events: [] }
}

// ─── Assistant message reducer ─────────────────────────────────────────

export function reduceAssistantMessage(
  slot: ContextSlot,
  msg: AssistantPayload
): ReductionResult {
  const content = msg.message.content
  const events: AgentEvent[] = []

  if (!slot._firstContentSeen) {
    events.push({ type: 'FIRST_CONTENT' })
  }

  if (slot._acc) {
    const commitUpdates = commitAccumulator(slot._acc, slot, content, 'complete')
    return { patch: { ...commitUpdates, _firstContentSeen: true }, events }
  }

  const msgId = msg.uuid || `assistant-${Date.now()}`
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

  return { patch: { messages: [...slot.messages, newMsg], _firstContentSeen: true }, events }
}

// ─── Stream event reducers ─────────────────────────────────────────────

export function reduceTextDelta(
  slot: ContextSlot,
  text: string
): { patch: Partial<ContextSlot>; firstContentSeenDuringThisCall: boolean } {
  let acc = slot._acc
  let firstContentSeenDuringThisCall = false

  if (!acc) {
    let msgId = `assistant-${Date.now()}`
    const lastMsg = slot.messages[slot.messages.length - 1]
    if (lastMsg?.kind === 'text' && lastMsg.phase !== 'complete') {
      msgId = lastMsg.id
    } else {
      const newAcc = ensureAccumulator(msgId, slot)
      newAcc.text = text
      const newMsg: TextMessage = {
        kind: 'text', id: msgId, role: 'assistant', phase: 'streaming',
        textContent: text, content: [], toolCalls: [], createdAt: Date.now(),
      }
      const msgs = [...slot.messages.filter((m) => !(m.kind === 'status' && m.phase === 'streaming')), newMsg]
      firstContentSeenDuringThisCall = !slot._firstContentSeen
      return { patch: { messages: msgs, _acc: newAcc, isStreaming: true, _firstContentSeen: true }, firstContentSeenDuringThisCall }
    }
    acc = ensureAccumulator(msgId, slot)
  }

  acc.text += text

  // P2 optimization: the streaming message is almost always the last one.
  // Check the last message first to avoid full-array copy + findIndex scan.
  const lastIdx = slot.messages.length - 1
  if (lastIdx >= 0 && slot.messages[lastIdx].id === acc!.messageId && slot.messages[lastIdx].kind === 'text') {
    // slice(0, -1) + concat avoids copying the last element; V8 optimizes this pattern.
    const last = slot.messages[lastIdx] as TextMessage
    const updatedLast = { ...last, textContent: acc.text, phase: 'streaming' as const }
    const msgs = slot.messages.slice(0, -1).concat([updatedLast])
    firstContentSeenDuringThisCall = !slot._firstContentSeen
    return { patch: { messages: msgs, _acc: acc, _firstContentSeen: true }, firstContentSeenDuringThisCall }
  }

  const msgs = [...slot.messages]
  const idx = msgs.findIndex((m) => m.id === acc!.messageId)
  if (idx >= 0 && msgs[idx].kind === 'text') {
    msgs[idx] = { ...msgs[idx], textContent: acc.text, phase: 'streaming' }
  }

  firstContentSeenDuringThisCall = !slot._firstContentSeen
  return { patch: { messages: msgs, _acc: acc, _firstContentSeen: true }, firstContentSeenDuringThisCall }
}

export function reduceInputJsonDelta(
  slot: ContextSlot,
  partialJson: string
): Partial<ContextSlot> | null {
  const acc = slot._acc
  if (!acc) return null

  const blocks = Array.from(acc.toolUseBlocks.entries())
  if (blocks.length > 0) {
    const [lastId, lastBlock] = blocks[blocks.length - 1]
    acc.toolUseBlocks.set(lastId, { ...lastBlock, inputJson: lastBlock.inputJson + partialJson })

    // P2 optimization: check last message first to avoid full-array copy + findIndex
    const lastIdx = slot.messages.length - 1
    if (lastIdx >= 0 && slot.messages[lastIdx].id === acc.messageId && slot.messages[lastIdx].kind === 'text') {
      const last = slot.messages[lastIdx] as TextMessage
      const updatedToolCalls = last.toolCalls.map((tc) =>
        tc.toolUseId === lastId
          ? { ...tc, inputJsonPartial: acc.toolUseBlocks.get(lastId)!.inputJson }
          : tc
      )
      const updatedLast = { ...last, toolCalls: updatedToolCalls }
      const msgs = slot.messages.slice(0, -1).concat([updatedLast])
      return { messages: msgs, _acc: acc }
    }

    const msgs = [...slot.messages]
    const idx = msgs.findIndex((m) => m.id === acc.messageId)
    if (idx >= 0 && msgs[idx].kind === 'text') {
      const updatedToolCalls = msgs[idx].toolCalls.map((tc) =>
        tc.toolUseId === lastId
          ? { ...tc, inputJsonPartial: acc.toolUseBlocks.get(lastId)!.inputJson }
          : tc
      )
      msgs[idx] = { ...msgs[idx], toolCalls: updatedToolCalls }
    }
    return { messages: msgs, _acc: acc }
  }
  return null
}

export function reduceContentBlockStart(
  slot: ContextSlot,
  block: ContentBlock
): { patch: Partial<ContextSlot> | null; firstContentSeenDuringThisCall: boolean } {
  let acc = slot._acc
  let firstContentSeenDuringThisCall = false

  if (!acc) {
    let msgId = `assistant-${Date.now()}`
    const lastMsg = slot.messages[slot.messages.length - 1]
    if (lastMsg?.kind === 'text' && lastMsg.phase !== 'complete') {
      msgId = lastMsg.id
    } else {
      const newMsg: TextMessage = {
        kind: 'text', id: msgId, role: 'assistant', phase: 'tool_calling',
        textContent: '', content: [], toolCalls: [], createdAt: Date.now(),
      }
      const msgs = [...slot.messages.filter((m) => !(m.kind === 'status' && m.phase === 'streaming')), newMsg]
      const newAcc = ensureAccumulator(msgId, slot)
      firstContentSeenDuringThisCall = !slot._firstContentSeen
      return { patch: { messages: msgs, _acc: newAcc, isStreaming: true, _firstContentSeen: true }, firstContentSeenDuringThisCall }
    }
    acc = ensureAccumulator(msgId, slot)
  }

  firstContentSeenDuringThisCall = !slot._firstContentSeen

  if (block.type === 'tool_use') {
    const name = block.name || 'unknown'
    acc.toolUseBlocks.set(block.id, { name, inputJson: '' })

    const newToolCall: ToolCallState = {
      toolUseId: block.id, toolName: name, input: {}, inputJsonPartial: '', status: 'pending',
    }

    // P2 optimization: check last message first to avoid full-array copy + findIndex
    const lastIdx = slot.messages.length - 1
    if (lastIdx >= 0 && slot.messages[lastIdx].id === acc!.messageId && slot.messages[lastIdx].kind === 'text') {
      const last = slot.messages[lastIdx] as TextMessage
      const existing = last.toolCalls.some((tc) => tc.toolUseId === block.id)
      if (!existing) {
        const updatedLast = { ...last, toolCalls: [...last.toolCalls, newToolCall], phase: 'tool_calling' as const }
        const msgs = slot.messages.slice(0, -1).concat([updatedLast])
        return { patch: { messages: msgs, _acc: acc, _firstContentSeen: true }, firstContentSeenDuringThisCall }
      }
      // No change to messages array — return same reference to skip React re-render
      return { patch: { _acc: acc, _firstContentSeen: true }, firstContentSeenDuringThisCall }
    }

    const msgs = [...slot.messages]
    const idx = msgs.findIndex((m) => m.id === acc!.messageId)
    if (idx >= 0 && msgs[idx].kind === 'text') {
      const existing = msgs[idx].toolCalls.some((tc) => tc.toolUseId === block.id)
      if (!existing) {
        msgs[idx] = { ...msgs[idx], toolCalls: [...msgs[idx].toolCalls, newToolCall], phase: 'tool_calling' }
      }
    }
    return { patch: { messages: msgs, _acc: acc, _firstContentSeen: true }, firstContentSeenDuringThisCall }
  }
  return { patch: null, firstContentSeenDuringThisCall: false }
}

export function reduceContentBlockStop(slot: ContextSlot): Partial<ContextSlot> | null {
  const acc = slot._acc
  if (!acc) return null

  // P2 optimization: check last message first to avoid full-array copy + findIndex
  const lastIdx = slot.messages.length - 1
  if (lastIdx >= 0 && slot.messages[lastIdx].id === acc.messageId && slot.messages[lastIdx].kind === 'text') {
    const last = slot.messages[lastIdx] as TextMessage
    const updatedToolCalls = last.toolCalls.map((tc) => {
      const block = acc.toolUseBlocks.get(tc.toolUseId)
      if (!block) return tc
      let input: Record<string, unknown> = {}
      try { input = JSON.parse(block.inputJson) } catch {}
      return { ...tc, input, inputJsonPartial: undefined, status: 'running' as const }
    })
    const updatedLast = { ...last, toolCalls: updatedToolCalls }
    const msgs = slot.messages.slice(0, -1).concat([updatedLast])

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
  }

  const msgs = [...slot.messages]
  const idx = msgs.findIndex((m) => m.id === acc.messageId)
  if (idx < 0 || msgs[idx].kind !== 'text') return null

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
      return { messages: msgs, lastEditedFile: filePath, _acc: acc }
    }
  }
  return { messages: msgs, _acc: acc }
}

// ─── Stream event dispatcher ───────────────────────────────────────────

export function reduceStreamEvent(
  slot: ContextSlot,
  msg: StreamEventPayloadIPC
): { patch: Partial<ContextSlot> | null; firstContentSeenDuringThisCall: boolean } {
  const event = msg.event

  switch (event.type) {
    case 'content_block_delta': {
      const deltaEvent = event as StreamContentBlockDelta
      const delta = deltaEvent.delta
      if (delta.type === 'text_delta') {
        const result = reduceTextDelta(slot, (delta as TextDelta).text)
        return { patch: result.patch, firstContentSeenDuringThisCall: result.firstContentSeenDuringThisCall }
      }
      if (delta.type === 'input_json_delta') {
        return { patch: reduceInputJsonDelta(slot, (delta as InputJsonDelta).partial_json), firstContentSeenDuringThisCall: false }
      }
      return { patch: null, firstContentSeenDuringThisCall: false }
    }
    case 'content_block_start': {
      const result = reduceContentBlockStart(slot, (event as StreamContentBlockStart).content_block)
      return { patch: result.patch, firstContentSeenDuringThisCall: result.firstContentSeenDuringThisCall }
    }
    case 'content_block_stop': {
      return { patch: reduceContentBlockStop(slot), firstContentSeenDuringThisCall: false }
    }
    case 'message_start': {
      // Capture ttft_ms (time-to-first-token) for latency display
      const startEvent = event as StreamMessageStart
      if (startEvent.ttft_ms != null) {
        return {
          patch: { ttftMs: startEvent.ttft_ms },
          firstContentSeenDuringThisCall: false,
        }
      }
      return { patch: null, firstContentSeenDuringThisCall: false }
    }
    case 'message_delta':
    case 'message_stop':
      return { patch: null, firstContentSeenDuringThisCall: false }
    default:
      return { patch: null, firstContentSeenDuringThisCall: false }
  }
}

// ─── User message reducer ──────────────────────────────────────────────

export function reduceUserMessage(
  slot: ContextSlot,
  msg: UserPayload,
  isReplay: boolean
): Partial<ContextSlot> | null {
  const content = msg.message.content
  const toolResults = content.filter(isToolResultBlock)
  const textBlocks = content.filter(isTextBlock)
  const msgs = [...slot.messages]
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

  if (isReplay && textBlocks.length > 0) {
    const text = textBlocks.map((b) => b.text).join('')
    if (text && !msgs.some((m) => m.kind === 'user' && m.textContent === text)) {
      msgs.push({ kind: 'user', id: msg.uuid || `user-${Date.now()}`, role: 'user', textContent: text, createdAt: Date.now() })
      changed = true
    }
  }

  return changed ? { messages: msgs } : null
}

// ─── Result message reducer ────────────────────────────────────────────

export function reduceResultMessage(
  slot: ContextSlot,
  msg: AgentIPCMessage & { subtype?: string },
  abortGuardGen?: number
): { patch: Partial<ContextSlot> | null; events: AgentEvent[] } {
  if (msg.subtype === 'success') {
    const resultMsg = msg as ResultSuccessPayload
    // Detect output truncation or model refusal
    let patch: Partial<ContextSlot> = { usageInfo: resultMsg.usage, ttftMs: null }
    if (resultMsg.stop_reason === 'max_tokens') {
      const truncationNote: StoppedMessage = {
        kind: 'stopped', id: `truncate-${Date.now()}`, role: 'assistant', phase: 'stopped',
        textContent: '⚠️ 回复被截断（达到最大输出长度），内容可能不完整', createdAt: Date.now(),
      }
      patch = { ...patch, messages: [...slot.messages, truncationNote] }
    } else if (resultMsg.stop_reason === 'refusal') {
      const refusalNote: StoppedMessage = {
        kind: 'stopped', id: `refusal-${Date.now()}`, role: 'assistant', phase: 'stopped',
        textContent: '⚠️ 模型拒绝了此请求', createdAt: Date.now(),
      }
      patch = { ...patch, messages: [...slot.messages, refusalNote] }
    }
    return { patch, events: [{ type: 'RESULT_SUCCESS' }] }
  }

  const errorMsg = msg as ResultErrorPayload
  const errorText = errorMsg.errors.join('\n') || 'Agent error'
  const isAborted = /aborted|cancelled|canceled/i.test(errorText)

  // Map specific error subtypes to user-friendly messages
  const subtypeMessages: Record<string, string> = {
    error_max_turns: '已达最大执行轮次限制，任务可能未完成',
    error_max_budget_usd: '已超出预算限制，任务停止',
    error_max_structured_output_retries: '结构化输出验证失败次数过多',
  }
  const friendlyError = subtypeMessages[errorMsg.subtype]

  if (abortGuardGen !== undefined && slot._queryGeneration !== abortGuardGen) {
    return { patch: null, events: [] }
  }

  if (isAborted) {
    const lastMsg = slot.messages[slot.messages.length - 1]
    const stopNote: StoppedMessage = {
      kind: 'stopped', id: `stop-${Date.now()}`, role: 'assistant', phase: 'stopped',
      textContent: '我的思考被用户停止了', createdAt: Date.now(),
    }
    const msgs = lastMsg?.kind === 'text' && lastMsg.phase === 'streaming'
      ? [...slot.messages.slice(0, -1), { ...lastMsg, phase: 'complete' as const }, stopNote]
      : [...slot.messages, stopNote]
    return { patch: { messages: msgs, usageInfo: errorMsg.usage }, events: [{ type: 'RESULT_ERROR' }] }
  }

  return {
    patch: {
      messages: [...slot.messages, {
        kind: 'text' as const, id: `error-${Date.now()}`, role: 'assistant', phase: 'error',
        textContent: friendlyError || errorText, content: [], toolCalls: [], createdAt: Date.now(),
      }],
      usageInfo: errorMsg.usage,
    },
    events: [{ type: 'RESULT_ERROR' }],
  }
}

// ─── Replayed message builder (pure — no store access) ─────────────────

export function buildReplayedMessages(rawMessages: AgentIPCMessage[]): ConversationMessage[] {
  const messages: ConversationMessage[] = []
  // Map tool_use_id → index in messages[] for O(1) lookup instead of O(n) linear scan
  const toolUseIdToMsgIndex = new Map<string, number>()

  for (const raw of rawMessages) {
    if (raw.type === 'assistant') {
      const assistantMsg = raw as AssistantPayload
      const content = assistantMsg.message.content
      const msgId = assistantMsg.uuid || `assistant-${Date.now()}`
      const textContent = content.filter(isTextBlock).map(b => b.text).join('')
      const toolCalls: ToolCallState[] = content.filter(isToolUseBlock).map(tu => {
        let input: Record<string, unknown> = {}
        if (tu.input && typeof tu.input === 'object') input = tu.input
        return { toolUseId: tu.id || `tu-${Date.now()}`, toolName: tu.name || 'unknown', input, status: 'running' as const }
      })

      const msgIndex = messages.length
      // Record tool_use block ids → message index for O(1) lookup by subsequent user/system messages
      for (const tu of content.filter(isToolUseBlock)) {
        if (tu.id) toolUseIdToMsgIndex.set(tu.id, msgIndex)
      }

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

      if (toolResults.length > 0) {
        for (const tr of toolResults) {
          const toolUseId = tr.tool_use_id
          const resultContent = typeof tr.content === 'string'
            ? tr.content
            : Array.isArray(tr.content)
              ? tr.content.map(c => (typeof c === 'object' && c && 'text' in c ? (c as { text: string }).text : '')).join('')
              : JSON.stringify(tr.content)
          const isError = tr.is_error === true

          // O(1) Map lookup instead of O(n) linear scan over messages
          const msgIdx = toolUseIdToMsgIndex.get(toolUseId)
          if (msgIdx !== undefined) {
            const msgRef = messages[msgIdx] as TextMessage
            const tcIdx = msgRef.toolCalls.findIndex(tc => tc.toolUseId === toolUseId)
            if (tcIdx >= 0) {
              const updated = [...msgRef.toolCalls]
              updated[tcIdx] = {
                ...updated[tcIdx],
                result: resultContent,
                status: (isError ? 'error' : 'completed') as ToolCallState['status'],
              }
              messages[msgIdx] = { ...msgRef, toolCalls: updated } as TextMessage
            }
          }
        }
      }

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
        // O(1) Map lookup instead of O(n) linear scan over messages
        const msgIdx = toolUseIdToMsgIndex.get(pd.tool_use_id)
        if (msgIdx !== undefined) {
          const msgRef = messages[msgIdx] as TextMessage
          const tcIdx = msgRef.toolCalls.findIndex(tc => tc.toolUseId === pd.tool_use_id)
          if (tcIdx >= 0) {
            const updated = [...msgRef.toolCalls]
            updated[tcIdx] = {
              ...updated[tcIdx],
              status: 'error' as const,
              result: `Permission denied: ${pd.message}`,
            }
            messages[msgIdx] = { ...msgRef, toolCalls: updated } as TextMessage
          }
        }
      }
    } else if (raw.type === 'result') {
      const resultSubtype = (raw as Record<string, unknown>).subtype as string | undefined
      if (resultSubtype?.startsWith('error')) {
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
    }
  }

  return messages
}
