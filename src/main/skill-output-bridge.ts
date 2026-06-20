import type { SDKMessage, SDKPartialAssistantMessage } from '@anthropic-ai/claude-agent-sdk'
import type {
  AgentContext,
  AgentSessionEnvelope,
  SessionRoutedSkillOutputState,
  SkillOutputState,
} from '../shared/types'

/**
 * SkillOutputBridge — unified output capture layer in main process.
 *
 * Monitors raw SDK stream events and detects output from any channel:
 *   Channel 1: skill-output code blocks in text deltas
 *   Channel 2: Write/Edit tool content in input_json_delta events
 *
 * Normalizes all output into a single IPC event (skill:output) pushed to the renderer.
 * The renderer never needs to know which channel produced the output.
 *
 * IMPORTANT: This class processes RAW SDK events (before toAgentIPCMessage conversion),
 * because the conversion loses the stream event structure the bridge needs.
 *
 * Each concurrent session gets its own internal state via queryKey-scoped
 * accumulators, so sessions A and B in the same context never interfere.
 */
export class SkillOutputBridge {
  private outputEmitter: ((state: SessionRoutedSkillOutputState) => void) | null = null

  setOutputEmitter(emitter: (state: SessionRoutedSkillOutputState) => void): void {
    this.outputEmitter = emitter
  }

  // ─── Per-session state (keyed by queryKey = sessionId || context) ──────

  private sessions = new Map<string, PerSessionState>()

  private getOrCreate(queryKey: string): PerSessionState {
    let s = this.sessions.get(queryKey)
    if (!s) {
      s = {
        context: 'editor',
        state: { skillId: null, content: '', isStreaming: false, language: 'html' },
        writeAccumulators: new Map(),
        inSkillOutputBlock: false,
        skillOutputAccumulator: '',
        textBuffer: '',
        _lastPushedLen: 0,
      }
      this.sessions.set(queryKey, s)
    }
    return s
  }

  /** Reset accumulators for a specific session before starting a new query. */
  reset(queryKey: string, envelope: AgentSessionEnvelope): void {
    const s = this.sessions.get(queryKey)
    if (s) {
      s.context = envelope.context
      s.state = { skillId: null, content: '', isStreaming: false, language: 'html', ...envelope }
      s.writeAccumulators.clear()
      s.inSkillOutputBlock = false
      s.skillOutputAccumulator = ''
      s.textBuffer = ''
      s._lastPushedLen = 0
    } else {
      this.sessions.set(queryKey, {
        context: envelope.context,
        state: { skillId: null, content: '', isStreaming: false, language: 'html', ...envelope },
        writeAccumulators: new Map(),
        inSkillOutputBlock: false,
        skillOutputAccumulator: '',
        textBuffer: '',
        _lastPushedLen: 0,
      })
    }
  }

  /** Attach the SDK session id after Claude materializes the app session. */
  setSessionId(queryKey: string, sessionId: string): void {
    const s = this.sessions.get(queryKey)
    if (!s) return
    s.state = { ...s.state, sdkSessionId: sessionId }
  }

  setSessionEnvelope(queryKey: string, envelope: AgentSessionEnvelope): void {
    const s = this.sessions.get(queryKey)
    if (!s) return
    s.context = envelope.context
    s.state = { ...s.state, ...envelope }
  }

  /** Clean up a session's accumulators when its query completes or is aborted. */
  cleanup(queryKey: string): void {
    this.sessions.delete(queryKey)
  }

  /**
   * Process a raw SDK stream event.
   * Called BEFORE toAgentIPCMessage() — operates on the original event structure.
   */
  processRawEvent(queryKey: string, rawMessage: SDKMessage, activeSkillId: string | null): void {
    if (rawMessage.type !== 'stream_event') return
    const streamMsg = rawMessage as SDKPartialAssistantMessage
    const event = streamMsg.event
    const eventType = event.type
    const s = this.getOrCreate(queryKey)

    switch (eventType) {
      case 'content_block_delta': {
        const delta = event.delta
        if (!delta) return
        const deltaType = delta.type

        if (deltaType === 'text_delta') {
          this.handleTextDelta(s, queryKey, (delta as { text: string }).text || '', activeSkillId)
        }

        if (deltaType === 'input_json_delta') {
          const blockIndex = (event as { index: number }).index || 0
          this.handleJsonDelta(s, queryKey, (delta as { partial_json: string }).partial_json || '', activeSkillId)
        }
        return
      }

      case 'content_block_start': {
        const block = (event as { content_block?: unknown }).content_block as { type?: string; name?: string; id?: string } | undefined
        if (block && block.type === 'tool_use') {
          const name = block.name || ''
          if (name === 'Write' || name === 'Edit') {
            const id = block.id || `tu-${Date.now()}`
            s.writeAccumulators.set(id, { toolName: name, json: '' })
          }
        }
        return
      }

      case 'content_block_stop': {
        // Finalize the oldest unfinalized Write/Edit accumulator
        if (s.writeAccumulators.size > 0) {
          const firstEntry = s.writeAccumulators.entries().next()
          if (!firstEntry.done) {
            const [id, acc] = firstEntry.value
            if (acc.json.length > 0) {
              this.finalizeWriteTool(s, queryKey, id, acc, activeSkillId)
            } else {
              s.writeAccumulators.delete(id)
            }
          }
        }
        return
      }

      default:
        return
    }
  }

  // ─── Private helpers ──────────────────────────────────────────────────

  private handleTextDelta(s: PerSessionState, queryKey: string, text: string, activeSkillId: string | null): void {
    s.textBuffer += text

    if (!s.inSkillOutputBlock) {
      const fenceMarker = '```skill-output\n'
      const startIdx = s.textBuffer.indexOf(fenceMarker)
      if (startIdx !== -1) {
        s.inSkillOutputBlock = true
        s.skillOutputAccumulator = ''
        s.state.skillId = activeSkillId
        s.state.isStreaming = true
        s.state.language = 'html'

        const afterFence = s.textBuffer.substring(startIdx + fenceMarker.length)
        s.skillOutputAccumulator += afterFence
        s.textBuffer = ''

        this.pushOutput(s, queryKey, {
          skillId: activeSkillId,
          content: s.skillOutputAccumulator,
          isStreaming: true,
          language: s.state.language,
          context: s.context,
          sessionId: s.state.sessionId || queryKey,
          clientSessionKey: s.state.clientSessionKey || s.state.sessionId || queryKey,
          sdkSessionId: s.state.sdkSessionId,
        })
      } else {
        // Keep tail for potential split fence marker (17 chars)
        if (s.textBuffer.length > 32) {
          s.textBuffer = s.textBuffer.slice(-16)
        }
      }
    } else {
      const closeIdx = s.textBuffer.indexOf('```')
      if (closeIdx !== -1) {
        s.skillOutputAccumulator += s.textBuffer.substring(0, closeIdx)
        s.inSkillOutputBlock = false
        s.textBuffer = ''
        this.pushOutput(s, queryKey, {
          skillId: activeSkillId,
          content: s.skillOutputAccumulator,
          isStreaming: false,
          language: s.state.language,
          context: s.context,
          sessionId: s.state.sessionId || queryKey,
          clientSessionKey: s.state.clientSessionKey || s.state.sessionId || queryKey,
          sdkSessionId: s.state.sdkSessionId,
        })
        return
      }
      s.skillOutputAccumulator += s.textBuffer
      s.textBuffer = ''

      this.pushOutput(s, queryKey, {
        skillId: activeSkillId,
        content: s.skillOutputAccumulator,
        isStreaming: true,
        language: s.state.language,
        context: s.context,
        sessionId: s.state.sessionId || queryKey,
        clientSessionKey: s.state.clientSessionKey || s.state.sessionId || queryKey,
        sdkSessionId: s.state.sdkSessionId,
      })
    }
  }

  private handleJsonDelta(s: PerSessionState, queryKey: string, partialJson: string, activeSkillId: string | null): void {
    if (s.writeAccumulators.size === 0) return

    const entries = [...s.writeAccumulators.entries()]
    const [, acc] = entries[entries.length - 1] // append to newest accumulator

    acc.json += partialJson

    const content = this.extractContentFromPartialJson(acc.json)
    if (content !== null && content.length > 0) {
      const lastPushedLen = s._lastPushedLen
      if (content.length - lastPushedLen > 500 || !s.state.isStreaming) {
        const language = this.guessLanguageFromContent(content)
        s._lastPushedLen = content.length
        this.pushOutput(s, queryKey, {
          skillId: activeSkillId,
          content,
          isStreaming: true,
          language,
          context: s.context,
          sessionId: s.state.sessionId || queryKey,
          clientSessionKey: s.state.clientSessionKey || s.state.sessionId || queryKey,
          sdkSessionId: s.state.sdkSessionId,
        })
      }
    }
  }

  private finalizeWriteTool(s: PerSessionState, queryKey: string, id: string, acc: { toolName: string; json: string }, activeSkillId: string | null): void {
    try {
      const parsed = JSON.parse(acc.json)
      const content = parsed.content as string | undefined
      if (content) {
        const language = this.guessLanguageFromContent(content)
        this.pushOutput(s, queryKey, {
          skillId: activeSkillId,
          content,
          isStreaming: false,
          language,
          context: s.context,
          sessionId: s.state.sessionId || queryKey,
          clientSessionKey: s.state.clientSessionKey || s.state.sessionId || queryKey,
          sdkSessionId: s.state.sdkSessionId,
        })
      }
    } catch {
      // JSON parse failed — content already pushed incrementally
    }
    s.writeAccumulators.delete(id)
    s._lastPushedLen = 0
  }

  private extractContentFromPartialJson(json: string): string | null {
    const contentStart = json.indexOf('"content"')
    if (contentStart === -1) return null

    const colonIdx = json.indexOf(':', contentStart + 9)
    if (colonIdx === -1) return null

    const quoteIdx = json.indexOf('"', colonIdx + 1)
    if (quoteIdx === -1) return null

    const raw = json.substring(quoteIdx + 1)

    let result = ''
    let i = 0
    while (i < raw.length) {
      if (raw[i] === '\\' && i + 1 < raw.length) {
        const next = raw[i + 1]
        if (next === 'n') { result += '\n'; i += 2; continue }
        if (next === '"') { result += '"'; i += 2; continue }
        if (next === '\\') { result += '\\'; i += 2; continue }
        if (next === 't') { result += '\t'; i += 2; continue }
        if (next === 'r') { result += '\r'; i += 2; continue }
        result += raw[i]; i += 1
      } else if (raw[i] === '"') {
        const after = raw.substring(i + 1).trimStart()
        if (after === '' || after[0] === ',' || after[0] === '}' || after[0] === ']') {
          break
        }
        result += raw[i]; i += 1
      } else {
        result += raw[i]; i += 1
      }
    }

    return result || null
  }

  private guessLanguageFromContent(content: string): string {
    const trimmed = content.trimStart()
    if (trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<html')) return 'html'
    if (trimmed.startsWith('<svg')) return 'svg'
    if (trimmed.startsWith('#') || trimmed.startsWith('---')) return 'markdown'
    return 'text'
  }

  private pushOutput(s: PerSessionState, queryKey: string, state: SkillOutputState): void {
    const sessionId = state.sessionId || s.state.sessionId || queryKey
    const routedState: SessionRoutedSkillOutputState = {
      ...s.state,
      ...state,
      context: state.context || s.context,
      sessionId,
      clientSessionKey: state.clientSessionKey || s.state.clientSessionKey || sessionId,
      sdkSessionId: state.sdkSessionId || s.state.sdkSessionId,
      workspacePath: state.workspacePath || s.state.workspacePath || '',
    }
    s.state = routedState
    this.outputEmitter?.(routedState)
  }
}

// ─── Per-session accumulator state ──────────────────────────────────────

interface PerSessionState {
  context: AgentContext
  state: SkillOutputState
  writeAccumulators: Map<string, { toolName: string; json: string }>
  inSkillOutputBlock: boolean
  skillOutputAccumulator: string
  textBuffer: string
  _lastPushedLen: number
}
