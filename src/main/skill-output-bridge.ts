import { BrowserWindow } from 'electron'

interface SkillOutputState {
  skillId: string | null
  content: string
  isStreaming: boolean
  language: string
}

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
 */
export class SkillOutputBridge {
  private win: BrowserWindow | null = null
  private state: SkillOutputState = {
    skillId: null,
    content: '',
    isStreaming: false,
    language: 'html',
  }

  // Accumulator for Write/Edit tool content (partial JSON), keyed by tool_use block ID
  private writeAccumulators = new Map<string, { toolName: string; json: string }>()

  // Track active skill-output code block
  private inSkillOutputBlock = false
  private skillOutputAccumulator = ''
  // Buffer for detecting fence markers split across deltas
  private textBuffer = ''

  setWindow(win: BrowserWindow) {
    this.win = win
  }

  reset() {
    this.state = { skillId: null, content: '', isStreaming: false, language: 'html' }
    this.writeAccumulators.clear()
    this.inSkillOutputBlock = false
    this.skillOutputAccumulator = ''
    this.textBuffer = ''
  }

  /**
   * Process a raw SDK stream event.
   * Called BEFORE toAgentIPCMessage() — operates on the original event structure.
   */
  processRawEvent(rawMessage: Record<string, unknown>, activeSkillId: string | null): void {
    const type = (rawMessage.type as string) || ''
    if (type !== 'stream_event') {
      console.log('[Bridge] skipping non-stream_event, type=', type)
      return
    }

    const event = rawMessage.event as Record<string, unknown> | undefined
    if (!event) return

    const eventType = (event.type as string) || ''
    console.log('[Bridge] stream_event, type=', eventType, 'deltaType=', (event.delta as any)?.type, 'skillId=', activeSkillId)

    switch (eventType) {
      case 'content_block_delta': {
        const delta = event.delta as Record<string, unknown> | undefined
        if (!delta) return
        const deltaType = (delta.type as string) || ''

        if (deltaType === 'text_delta') {
          this.handleTextDelta((delta.text as string) || '', activeSkillId)
        }

        if (deltaType === 'input_json_delta') {
          const blockIndex = (event.index as number) || 0
          this.handleJsonDelta((delta.partial_json as string) || '', blockIndex, activeSkillId)
        }
        return
      }

      case 'content_block_start': {
        const block = event.content_block as Record<string, unknown> | undefined
        if (block && (block.type as string) === 'tool_use') {
          const name = (block.name as string) || ''
          if (name === 'Write' || name === 'Edit') {
            const id = (block.id as string) || `tu-${Date.now()}`
            console.log('[Bridge] detected tool_use start:', name, 'id=', id)
            this.writeAccumulators.set(id, { toolName: name, json: '' })
          }
        }
        return
      }

      case 'content_block_stop': {
        const index = (event.index as number) || 0
        // Finalize the accumulator matching this block index
        // The SDK sends content_block_stop events in order, so we finalize
        // the oldest accumulator that hasn't been finalized yet.
        if (this.writeAccumulators.size > 0) {
          const firstEntry = this.writeAccumulators.entries().next()
          if (!firstEntry.done) {
            const [id, acc] = firstEntry.value
            if (acc.json.length > 0) {
              this.finalizeWriteTool(id, acc, activeSkillId)
            } else {
              this.writeAccumulators.delete(id)
            }
          }
        }
        return
      }

      default:
        return
    }
  }

  private handleTextDelta(text: string, activeSkillId: string | null): void {
    // Buffer text to handle fence markers split across deltas
    this.textBuffer += text

    if (!this.inSkillOutputBlock) {
      // Look for ```skill-output\n in the buffer
      const fenceMarker = '```skill-output\n'
      const startIdx = this.textBuffer.indexOf(fenceMarker)
      if (startIdx !== -1) {
        this.inSkillOutputBlock = true
        this.skillOutputAccumulator = ''
        this.state.skillId = activeSkillId
        this.state.isStreaming = true
        this.state.language = 'html'

        const afterFence = this.textBuffer.substring(startIdx + fenceMarker.length)
        this.skillOutputAccumulator += afterFence
        this.textBuffer = '' // consumed

        this.pushOutput({
          skillId: activeSkillId,
          content: this.skillOutputAccumulator,
          isStreaming: true,
          language: this.state.language,
        })
      } else {
        // Keep only the tail of the buffer (enough to detect a split fence marker)
        // The fence marker is 17 chars, so keep last 16 chars as potential partial match
        if (this.textBuffer.length > 32) {
          this.textBuffer = this.textBuffer.slice(-16)
        }
      }
    } else {
      // Inside skill-output block — check for closing fence
      const closeIdx = this.textBuffer.indexOf('```')
      if (closeIdx !== -1) {
        this.skillOutputAccumulator += this.textBuffer.substring(0, closeIdx)
        this.inSkillOutputBlock = false
        this.textBuffer = ''
        this.pushOutput({
          skillId: activeSkillId,
          content: this.skillOutputAccumulator,
          isStreaming: false,
          language: this.state.language,
        })
        return
      }
      this.skillOutputAccumulator += this.textBuffer
      this.textBuffer = ''

      this.pushOutput({
        skillId: activeSkillId,
        content: this.skillOutputAccumulator,
        isStreaming: true,
        language: this.state.language,
      })
    }
  }

  private handleJsonDelta(partialJson: string, blockIndex: number, activeSkillId: string | null): void {
    // Append to the accumulator matching the block index
    // Since blocks arrive in order, we use the first (oldest) accumulator
    if (this.writeAccumulators.size === 0) return

    const entries = [...this.writeAccumulators.entries()]
    // Use blockIndex to find the right accumulator — but since we key by ID not index,
    // pick the entry at the corresponding position
    const entryIdx = Math.min(blockIndex, entries.length - 1)
    const [id, acc] = entries[entryIdx]

    acc.json += partialJson

    // Throttle: only push every ~500 chars to avoid flooding the renderer
    const content = this.extractContentFromPartialJson(acc.json)
    if (content !== null && content.length > 0) {
      const lastPushedLen = this._lastPushedLen
      if (content.length - lastPushedLen > 500 || !this.state.isStreaming) {
        const language = this.guessLanguageFromContent(content)
        this._lastPushedLen = content.length
        this.pushOutput({
          skillId: activeSkillId,
          content,
          isStreaming: true,
          language,
        })
      }
    }
  }

  private _lastPushedLen = 0

  private finalizeWriteTool(id: string, acc: { toolName: string; json: string }, activeSkillId: string | null): void {
    try {
      const parsed = JSON.parse(acc.json)
      const content = parsed.content as string | undefined
      if (content) {
        const language = this.guessLanguageFromContent(content)
        this.pushOutput({
          skillId: activeSkillId,
          content,
          isStreaming: false,
          language,
        })
      }
    } catch {
      // JSON parse failed — content already pushed incrementally
    }
    this.writeAccumulators.delete(id)
    this._lastPushedLen = 0
  }

  /**
   * Extract the "content" field value from a partial JSON string.
   * Handles incomplete JSON where the content string is still being built.
   */
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

  private pushOutput(state: SkillOutputState): void {
    this.state = state
    console.log('[Bridge] pushOutput, isStreaming=', state.isStreaming, 'contentLen=', state.content.length, 'lang=', state.language)
    if (!this.win || this.win.isDestroyed()) return
    this.win.webContents.send('skill:output', {
      skillId: state.skillId,
      content: state.content,
      isStreaming: state.isStreaming,
      language: state.language,
    })
  }
}
