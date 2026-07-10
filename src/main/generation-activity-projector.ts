import type { SDKMessage, SDKPartialAssistantMessage } from '@anthropic-ai/claude-agent-sdk'
import type {
  AgentSessionEnvelope,
  GenerationActivity,
  GenerationActivityPhase,
  SessionRoutedGenerationActivity,
} from '../shared/types'

const PREVIEW_UPDATE_INTERVAL_MS = 80
const SKILL_OUTPUT_FENCE = '```skill-output\n'
const PREVIEW_TOOL_NAMES = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash'])
const TERMINAL_PHASES = new Set<GenerationActivityPhase>(['completed', 'failed', 'cancelled'])

type ToolAccumulator = {
  toolUseId: string
  toolName: string
  inputJson: string
  updatedAt: number
  activity: GenerationActivity
}

type ProjectionSession = {
  envelope: AgentSessionEnvelope
  skillId: string | null
  toolBlocks: Map<number, ToolAccumulator>
  skillOutputActive: boolean
  skillOutputActivityId: string | null
  skillOutputBuffer: string
  textBuffer: string
  lastEmittedAt: number
  pendingActivity: GenerationActivity | null
  pendingTimer: ReturnType<typeof setTimeout> | null
}

/**
 * Projects Claude Agent SDK streaming events into one session-routed product
 * concept: live generation activity. SDK event shapes and tool input parsing
 * stay behind this module's interface; the renderer never sees them.
 */
export class GenerationActivityProjector {
  private sessions = new Map<string, ProjectionSession>()
  private emitter: ((activity: SessionRoutedGenerationActivity) => void) | null = null

  setEmitter(emitter: (activity: SessionRoutedGenerationActivity) => void): void {
    this.emitter = emitter
  }

  reset(queryKey: string, envelope: AgentSessionEnvelope, skillId: string | null = null): void {
    this.cleanup(queryKey)
    this.sessions.set(queryKey, {
      envelope,
      skillId,
      toolBlocks: new Map(),
      skillOutputActive: false,
      skillOutputActivityId: null,
      skillOutputBuffer: '',
      textBuffer: '',
      lastEmittedAt: 0,
      pendingActivity: null,
      pendingTimer: null,
    })
  }

  setSessionEnvelope(queryKey: string, envelope: AgentSessionEnvelope): void {
    const session = this.sessions.get(queryKey)
    if (session) session.envelope = envelope
  }

  processRawMessage(queryKey: string, rawMessage: SDKMessage, skillId: string | null): void {
    const session = this.sessions.get(queryKey)
    if (!session) return
    session.skillId = skillId

    if (rawMessage.type === 'result') {
      this.finishSession(queryKey, rawMessage.subtype === 'success' ? 'completed' : 'failed')
      return
    }
    if (rawMessage.type !== 'stream_event') return

    const streamMessage = rawMessage as SDKPartialAssistantMessage
    const event = streamMessage.event
    const index = 'index' in event && typeof event.index === 'number' ? event.index : 0

    if (event.type === 'content_block_start') {
      const block = event.content_block as { type?: string; name?: string; id?: string }
      if (block?.type !== 'tool_use' || !PREVIEW_TOOL_NAMES.has(block.name || '')) return
      // A normal Bash call is not necessarily producing an artifact. Skill runs
      // are the explicit product context where Bash-backed generation should
      // surface activity, without guessing intent from command text.
      if (block.name === 'Bash' && !session.skillId) return

      const toolName = block.name || 'Tool'
      const toolUseId = block.id || `${streamMessage.uuid || queryKey}:${index}`
      const activity: GenerationActivity = {
        activityId: `tool:${toolUseId}`,
        skillId,
        phase: 'preparing',
        source: 'tool-input',
        toolName,
        label: preparingLabel(toolName),
        content: '',
        language: 'text',
      }
      session.toolBlocks.set(index, {
        toolUseId,
        toolName,
        inputJson: '',
        updatedAt: Date.now(),
        activity,
      })
      this.emitImmediate(session, activity)
      return
    }

    if (event.type === 'content_block_delta') {
      const delta = event.delta
      if (delta.type === 'text_delta') {
        this.processTextDelta(session, delta.text || '', streamMessage.uuid || queryKey)
        return
      }
      if (delta.type !== 'input_json_delta') return

      const accumulator = session.toolBlocks.get(index)
      if (!accumulator) return
      accumulator.inputJson += delta.partial_json || ''
      accumulator.updatedAt = Date.now()

      const preview = previewFromPartialInput(accumulator.toolName, accumulator.inputJson)
      const content = preview.content ?? accumulator.activity.content
      const activity: GenerationActivity = {
        ...accumulator.activity,
        phase: content ? 'generating' : 'preparing',
        label: content ? generatingLabel(accumulator.toolName) : preparingLabel(accumulator.toolName),
        content,
        language: preview.language || accumulator.activity.language,
      }
      accumulator.activity = activity
      this.queueActivity(session, activity)
      return
    }

    if (event.type === 'content_block_stop') {
      const accumulator = session.toolBlocks.get(index)
      if (!accumulator) return

      const preview = previewFromCompleteInput(accumulator.toolName, accumulator.inputJson)
      const content = preview.content ?? accumulator.activity.content
      const activity: GenerationActivity = {
        ...accumulator.activity,
        phase: 'finalizing',
        label: finalizingLabel(accumulator.toolName),
        content,
        language: preview.language || accumulator.activity.language,
      }
      accumulator.activity = activity
      accumulator.updatedAt = Date.now()
      this.emitImmediate(session, activity)
    }
  }

  finishTool(queryKey: string, toolUseId: string, outcome: 'completed' | 'failed'): void {
    const session = this.sessions.get(queryKey)
    if (!session) return
    const entry = [...session.toolBlocks.entries()].find(([, block]) => block.toolUseId === toolUseId)
    if (!entry) return

    const [index, block] = entry
    this.emitImmediate(session, {
      ...block.activity,
      phase: outcome,
      label: outcome === 'completed' ? '生成完成' : '生成失败',
    })
    session.toolBlocks.delete(index)
    this.restoreMostRecentActivity(session)
  }

  finishSession(queryKey: string, phase: 'completed' | 'failed' | 'cancelled'): void {
    const session = this.sessions.get(queryKey)
    if (!session) return

    const active = mostRecentToolBlock(session)?.activity || this.currentSkillOutputActivity(session)
    if (active) {
      this.emitImmediate(session, {
        ...active,
        phase,
        label: phase === 'completed' ? '生成完成' : phase === 'failed' ? '生成失败' : '已停止生成',
      })
    }
    session.toolBlocks.clear()
    session.skillOutputActive = false
    session.skillOutputActivityId = null
  }

  cleanup(queryKey: string): void {
    const session = this.sessions.get(queryKey)
    if (session?.pendingTimer) clearTimeout(session.pendingTimer)
    this.sessions.delete(queryKey)
  }

  cleanupAll(): void {
    for (const key of this.sessions.keys()) this.cleanup(key)
  }

  private processTextDelta(session: ProjectionSession, text: string, messageId: string): void {
    session.textBuffer += text

    if (!session.skillOutputActive) {
      const startIndex = session.textBuffer.indexOf(SKILL_OUTPUT_FENCE)
      if (startIndex === -1) {
        if (session.textBuffer.length > SKILL_OUTPUT_FENCE.length * 2) {
          session.textBuffer = session.textBuffer.slice(-(SKILL_OUTPUT_FENCE.length - 1))
        }
        return
      }

      session.skillOutputActive = true
      session.skillOutputActivityId = `skill-output:${messageId}`
      session.skillOutputBuffer = ''
      session.textBuffer = session.textBuffer.slice(startIndex + SKILL_OUTPUT_FENCE.length)
      this.emitImmediate(session, {
        activityId: session.skillOutputActivityId,
        skillId: session.skillId,
        phase: 'preparing',
        source: 'skill-output',
        label: '正在生成内容',
        content: '',
        language: 'text',
      })
    }

    const closeIndex = session.textBuffer.indexOf('```')
    if (closeIndex !== -1) {
      session.skillOutputBuffer += session.textBuffer.slice(0, closeIndex)
      const activity = this.currentSkillOutputActivity(session)
      if (activity) {
        this.emitImmediate(session, { ...activity, phase: 'completed', label: '生成完成' })
      }
      session.skillOutputActive = false
      session.skillOutputActivityId = null
      session.textBuffer = session.textBuffer.slice(closeIndex + 3)
      return
    }

    session.skillOutputBuffer += session.textBuffer
    session.textBuffer = ''
    const activity = this.currentSkillOutputActivity(session)
    if (activity) this.queueActivity(session, activity)
  }

  private currentSkillOutputActivity(session: ProjectionSession): GenerationActivity | null {
    if (!session.skillOutputActive || !session.skillOutputActivityId) return null
    return {
      activityId: session.skillOutputActivityId,
      skillId: session.skillId,
      phase: session.skillOutputBuffer ? 'generating' : 'preparing',
      source: 'skill-output',
      label: session.skillOutputBuffer ? '正在生成内容' : '准备生成内容',
      content: session.skillOutputBuffer,
      language: guessLanguage(session.skillOutputBuffer),
    }
  }

  private restoreMostRecentActivity(session: ProjectionSession): void {
    const remaining = mostRecentToolBlock(session)?.activity || this.currentSkillOutputActivity(session)
    if (remaining && !TERMINAL_PHASES.has(remaining.phase)) this.emitImmediate(session, remaining)
  }

  private queueActivity(session: ProjectionSession, activity: GenerationActivity): void {
    session.pendingActivity = activity
    const elapsed = Date.now() - session.lastEmittedAt
    if (session.lastEmittedAt === 0 || elapsed >= PREVIEW_UPDATE_INTERVAL_MS) {
      this.flushPending(session)
      return
    }
    if (session.pendingTimer) return
    session.pendingTimer = setTimeout(() => {
      session.pendingTimer = null
      this.flushPending(session)
    }, PREVIEW_UPDATE_INTERVAL_MS - elapsed)
  }

  private flushPending(session: ProjectionSession): void {
    if (!session.pendingActivity) return
    const activity = session.pendingActivity
    session.pendingActivity = null
    this.emit(session, activity)
  }

  private emitImmediate(session: ProjectionSession, activity: GenerationActivity): void {
    if (session.pendingTimer) {
      clearTimeout(session.pendingTimer)
      session.pendingTimer = null
    }
    session.pendingActivity = null
    this.emit(session, activity)
  }

  private emit(session: ProjectionSession, activity: GenerationActivity): void {
    session.lastEmittedAt = Date.now()
    this.emitter?.({ ...activity, ...session.envelope })
  }
}

function mostRecentToolBlock(session: ProjectionSession): ToolAccumulator | null {
  let latest: ToolAccumulator | null = null
  for (const block of session.toolBlocks.values()) {
    if (!latest || block.updatedAt > latest.updatedAt) latest = block
  }
  return latest
}

function previewFromPartialInput(toolName: string, inputJson: string): { content: string | null; language?: string } {
  if (toolName === 'Write') {
    const content = extractPartialJsonStringValues(inputJson, 'content')[0] ?? null
    const path = extractPartialJsonStringValues(inputJson, 'file_path')[0]
    return { content, language: guessLanguage(content || '', path) }
  }
  if (toolName === 'Edit' || toolName === 'MultiEdit' || toolName === 'NotebookEdit') {
    const fragments = extractPartialJsonStringValues(inputJson, 'new_string')
    const path = extractPartialJsonStringValues(inputJson, 'file_path')[0]
    return {
      content: fragments.length > 0 ? fragments.join('\n\n') : null,
      language: guessLanguage(fragments.join('\n\n'), path),
    }
  }
  return { content: null }
}

function previewFromCompleteInput(toolName: string, inputJson: string): { content: string | null; language?: string } {
  try {
    const input = JSON.parse(inputJson) as Record<string, unknown>
    const path = typeof input.file_path === 'string' ? input.file_path : undefined
    if (toolName === 'Write') {
      const content = typeof input.content === 'string' ? input.content : null
      return { content, language: guessLanguage(content || '', path) }
    }
    if (toolName === 'Edit' || toolName === 'NotebookEdit') {
      const content = typeof input.new_string === 'string' ? input.new_string : null
      return { content, language: guessLanguage(content || '', path) }
    }
    if (toolName === 'MultiEdit' && Array.isArray(input.edits)) {
      const content = input.edits
        .map((edit) => edit && typeof edit === 'object' ? (edit as { new_string?: unknown }).new_string : '')
        .filter((value): value is string => typeof value === 'string' && value.length > 0)
        .join('\n\n')
      return { content: content || null, language: guessLanguage(content, path) }
    }
  } catch {
    return previewFromPartialInput(toolName, inputJson)
  }
  return { content: null }
}

/** Extract string properties from complete or incomplete streamed JSON. */
export function extractPartialJsonStringValues(input: string, fieldName: string): string[] {
  const values: string[] = []
  let cursor = 0

  while (cursor < input.length) {
    if (input[cursor] !== '"') {
      cursor += 1
      continue
    }

    const key = readJsonString(input, cursor + 1)
    if (!key.closed) break
    cursor = key.nextIndex
    if (key.value !== fieldName) continue

    let valueStart = cursor
    while (valueStart < input.length && /\s/.test(input[valueStart])) valueStart += 1
    if (input[valueStart] !== ':') continue
    valueStart += 1
    while (valueStart < input.length && /\s/.test(input[valueStart])) valueStart += 1
    if (input[valueStart] !== '"') continue

    const value = readJsonString(input, valueStart + 1)
    values.push(value.value)
    cursor = value.nextIndex
  }

  return values
}

function readJsonString(input: string, start: number): { value: string; nextIndex: number; closed: boolean } {
  let value = ''
  let index = start
  while (index < input.length) {
    const char = input[index]
    if (char === '"') return { value, nextIndex: index + 1, closed: true }
    if (char !== '\\') {
      value += char
      index += 1
      continue
    }

    if (index + 1 >= input.length) return { value, nextIndex: input.length, closed: false }
    const escape = input[index + 1]
    if (escape === 'u') {
      const hex = input.slice(index + 2, index + 6)
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) return { value, nextIndex: input.length, closed: false }
      value += String.fromCharCode(Number.parseInt(hex, 16))
      index += 6
      continue
    }

    const decoded: Record<string, string> = {
      '"': '"',
      '\\': '\\',
      '/': '/',
      b: '\b',
      f: '\f',
      n: '\n',
      r: '\r',
      t: '\t',
    }
    value += decoded[escape] ?? escape
    index += 2
  }
  return { value, nextIndex: input.length, closed: false }
}

function guessLanguage(content: string, filePath?: string): string {
  const extension = filePath?.split('.').pop()?.toLowerCase()
  if (extension === 'html' || extension === 'htm') return 'html'
  if (extension === 'md' || extension === 'markdown') return 'markdown'
  if (extension === 'svg') return 'svg'
  if (extension === 'json') return 'json'
  if (extension === 'js' || extension === 'mjs' || extension === 'cjs') return 'javascript'
  if (extension === 'ts' || extension === 'tsx') return 'typescript'
  if (extension === 'py') return 'python'

  const trimmed = content.trimStart()
  if (trimmed.startsWith('<!DOCTYPE') || /^<(html|head|body|main|section|article|div|style|script)\b/i.test(trimmed)) return 'html'
  if (trimmed.startsWith('<svg')) return 'svg'
  if (trimmed.startsWith('#') || trimmed.startsWith('---')) return 'markdown'
  return 'text'
}

function preparingLabel(toolName: string): string {
  if (toolName === 'Bash') return '准备执行生成任务'
  if (toolName === 'Edit' || toolName === 'MultiEdit' || toolName === 'NotebookEdit') return '准备更新内容'
  return '准备生成内容'
}

function generatingLabel(toolName: string): string {
  return toolName === 'Write' ? '正在生成内容' : '正在更新内容'
}

function finalizingLabel(toolName: string): string {
  return toolName === 'Bash' ? '正在执行生成任务' : '正在写入内容'
}
