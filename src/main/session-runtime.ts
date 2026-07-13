import type { BrowserWindow } from 'electron'
import type { PermissionMode, Query, SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import type { PermissionResult } from '@anthropic-ai/claude-agent-sdk'
import type {
  AgentIPCMessage,
  AgentNotificationPayload,
  AgentSessionEnvelope,
  AskUserRequestIPC,
  PermissionRequestIPC,
  SessionRoutedAgentIPCMessage,
  SessionRoutedAskUserRequest,
  SessionRoutedNotification,
  SessionRoutedPermissionRequest,
  SessionRoutedRequestTimeout,
} from '../shared/types'
import { withSessionEnvelope } from './session-envelope'
import { GenerationActivityProjector } from './generation-activity-projector'
import { toAgentIPCMessage } from './message-converter'
import {
  PendingInteractionController,
  type PermissionResponseOptions,
} from './pending-interactions'
import {
  discardAllTextBatches,
  discardTextBatch,
  flushTextBatch,
  isTextDeltaEvent,
  scheduleTextBatch,
} from './agent-text-batch'

interface ActiveSessionRun {
  query: Query
  skillId: string | null
  abortController: AbortController
  instanceId: number
  envelope: AgentSessionEnvelope
  completion: Promise<void>
}

export type SessionRuntimeStart = {
  query: Query
  skillId: string | null
  abortController: AbortController
  envelope: AgentSessionEnvelope
}

type PermissionRequestInput = Omit<PermissionRequestIPC, keyof AgentSessionEnvelope | 'id'>
type AskUserRequestInput = Omit<AskUserRequestIPC, keyof AgentSessionEnvelope | 'id'>

export class SessionRuntimeController {
  private instanceCounter = 0
  private activeRuns = new Map<string, ActiveSessionRun>()
  private generationProjector = new GenerationActivityProjector()
  private pendingInteractions = new PendingInteractionController()
  private generationWindow: BrowserWindow | null = null
  private completionResolvers = new Map<number, () => void>()

  constructor() {
    this.generationProjector.setEmitter((state) => {
      const win = this.generationWindow
      if (!win || win.isDestroyed()) return
      win.webContents.send('agent:generationActivity', state)
    })
  }

  setGenerationWindow(win: BrowserWindow): void {
    this.generationWindow = win
  }

  beginSession(envelope: AgentSessionEnvelope, skillId: string | null = null): void {
    this.generationProjector.reset(envelope.sessionId, envelope, skillId)
  }

  registerRun(input: SessionRuntimeStart): number {
    const instanceId = ++this.instanceCounter
    let resolveCompletion!: () => void
    const completion = new Promise<void>((resolve) => {
      resolveCompletion = resolve
    })
    this.completionResolvers.set(instanceId, resolveCompletion)
    this.activeRuns.set(input.envelope.sessionId, {
      query: input.query,
      skillId: input.skillId,
      abortController: input.abortController,
      instanceId,
      envelope: input.envelope,
      completion,
    })
    return instanceId
  }

  getActiveSkillId(sessionId: string): string | null {
    return this.activeRuns.get(sessionId)?.skillId ?? null
  }

  isSkillActive(skillId: string): boolean {
    for (const run of this.activeRuns.values()) {
      if (run.skillId === skillId) return true
    }
    return false
  }

  getEnvelope(sessionId: string): AgentSessionEnvelope | null {
    return this.activeRuns.get(sessionId)?.envelope ?? null
  }

  resolveEventEnvelope(
    sessionId: string,
    fallback: AgentSessionEnvelope,
    sdkSessionId?: string
  ): AgentSessionEnvelope {
    const envelope = this.getEnvelope(sessionId) || fallback
    return sdkSessionId ? { ...envelope, sdkSessionId } : envelope
  }

  materializeSdkSession(sessionId: string, sdkSessionId: string): AgentSessionEnvelope | null {
    const run = this.activeRuns.get(sessionId)
    if (!run) return null
    const envelope = { ...run.envelope, sdkSessionId }
    this.activeRuns.set(sessionId, { ...run, envelope })
    this.generationProjector.setSessionEnvelope(sessionId, envelope)
    return envelope
  }

  processGenerationRawMessage(sessionId: string, rawMessage: SDKMessage): void {
    const skillId = this.getActiveSkillId(sessionId)
    this.generationProjector.processRawMessage(sessionId, rawMessage, skillId)
  }

  finishGenerationTool(
    sessionId: string,
    toolUseId: string,
    outcome: 'completed' | 'failed'
  ): void {
    this.generationProjector.finishTool(sessionId, toolUseId, outcome)
  }

  emitSdkMessage(
    win: BrowserWindow,
    sessionId: string,
    envelope: AgentSessionEnvelope,
    rawMessage: SDKMessage
  ): void {
    this.processGenerationRawMessage(sessionId, rawMessage)

    const textDeltaText = isTextDeltaEvent(rawMessage)
    if (textDeltaText !== null) {
      const uuid = (rawMessage as { uuid?: string }).uuid || ''
      scheduleTextBatch(sessionId, textDeltaText, uuid, win, envelope)
      return
    }

    this.flushText(sessionId, win)
    const ipcMsg = toAgentIPCMessage(rawMessage)
    if (ipcMsg) {
      this.emitAgentEvent(win, envelope, ipcMsg)
    }
  }

  flushText(sessionId: string, win: BrowserWindow): void {
    flushTextBatch(sessionId, win)
  }

  emitAgentEvent(
    win: BrowserWindow,
    envelope: AgentSessionEnvelope,
    message: AgentIPCMessage
  ): void {
    if (win.isDestroyed()) return
    const payload: SessionRoutedAgentIPCMessage = withSessionEnvelope(envelope, message)
    win.webContents.send('agent:event', payload)
  }

  emitExecutionError(win: BrowserWindow, envelope: AgentSessionEnvelope, message: string): void {
    this.generationProjector.finishSession(envelope.sessionId, 'failed')
    this.emitAgentEvent(win, envelope, {
      type: 'result',
      subtype: 'error_during_execution',
      errors: [message],
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        cache_read_tokens: 0,
        cache_creation_tokens: 0,
      },
      total_cost_usd: 0,
      duration_ms: 0,
    } as AgentIPCMessage)
  }

  emitSessionCreated(win: BrowserWindow, envelope: AgentSessionEnvelope): void {
    if (win.isDestroyed()) return
    win.webContents.send('agent:sessionCreated', envelope)
  }

  emitPermissionRequest(
    win: BrowserWindow,
    envelope: AgentSessionEnvelope,
    request: Omit<PermissionRequestIPC, keyof AgentSessionEnvelope>
  ): void {
    if (win.isDestroyed()) return
    const payload: SessionRoutedPermissionRequest = withSessionEnvelope(envelope, request)
    win.webContents.send('agent:permissionRequest', payload)
  }

  emitAskUserRequest(
    win: BrowserWindow,
    envelope: AgentSessionEnvelope,
    request: Omit<AskUserRequestIPC, keyof AgentSessionEnvelope>
  ): void {
    if (win.isDestroyed()) return
    const payload: SessionRoutedAskUserRequest = withSessionEnvelope(envelope, request)
    win.webContents.send('agent:askUser', payload)
  }

  emitPermissionTimeout(win: BrowserWindow, envelope: AgentSessionEnvelope, requestId: string): void {
    if (win.isDestroyed()) return
    const payload: SessionRoutedRequestTimeout = withSessionEnvelope(envelope, { requestId })
    win.webContents.send('agent:permissionTimeout', payload)
  }

  emitAskUserTimeout(win: BrowserWindow, envelope: AgentSessionEnvelope, requestId: string): void {
    if (win.isDestroyed()) return
    const payload: SessionRoutedRequestTimeout = withSessionEnvelope(envelope, { requestId })
    win.webContents.send('agent:askUserTimeout', payload)
  }

  requestAskUserAnswer(
    win: BrowserWindow,
    envelope: AgentSessionEnvelope,
    request: AskUserRequestInput,
    originalInput: Record<string, unknown>
  ): Promise<PermissionResult> {
    return this.pendingInteractions.requestAskUser({
      sessionId: envelope.sessionId,
      originalInput,
      onRequest: (requestId) => this.emitAskUserRequest(win, envelope, {
        id: requestId,
        ...request,
      }),
      onTimeout: (requestId) => this.emitAskUserTimeout(win, envelope, requestId),
    })
  }

  requestPermissionApproval(
    win: BrowserWindow,
    envelope: AgentSessionEnvelope,
    request: PermissionRequestInput,
    signal?: AbortSignal
  ): Promise<PermissionResult> {
    return this.pendingInteractions.requestPermission({
      sessionId: envelope.sessionId,
      toolName: request.toolName,
      input: request.input,
      signal,
      onRequest: (requestId) => this.emitPermissionRequest(win, envelope, {
        id: requestId,
        ...request,
      }),
      onTimeout: (requestId) => this.emitPermissionTimeout(win, envelope, requestId),
      onCancelled: (requestId) => this.emitPermissionTimeout(win, envelope, requestId),
    })
  }

  resolvePermission(
    requestId: string,
    behavior: 'allow' | 'deny',
    options?: PermissionResponseOptions
  ): void {
    this.pendingInteractions.resolvePermission(requestId, behavior, options)
  }

  resolveAskUser(requestId: string, answers: Record<string, string>): void {
    this.pendingInteractions.resolveAskUser(requestId, answers)
  }

  emitNotification(
    win: BrowserWindow,
    envelope: AgentSessionEnvelope,
    notification: AgentNotificationPayload
  ): void {
    if (win.isDestroyed()) return
    const payload: SessionRoutedNotification & { workspaceCwd: string } = {
      ...withSessionEnvelope(envelope, {
        ...notification,
        target: notification.target ?? {
          view: envelope.context === 'ask' ? 'ask' : 'editor',
          sessionId: envelope.sessionId,
          workspacePath: envelope.workspacePath,
        },
      }),
      workspaceCwd: envelope.workspacePath,
    }
    win.webContents.send('agent:notification', payload)
  }

  abort(queryKey?: string): void {
    if (queryKey) {
      const matchedKey = this.findRunKey(queryKey)
      if (matchedKey) {
        const run = this.activeRuns.get(matchedKey)
        this.generationProjector.finishSession(matchedKey, 'cancelled')
        run?.abortController.abort()
        this.pendingInteractions.reject(matchedKey)
        discardTextBatch(matchedKey)
        return
      }

      this.pendingInteractions.reject(queryKey)
      discardTextBatch(queryKey)
      return
    }

    for (const [key, run] of this.activeRuns) {
      this.generationProjector.finishSession(key, 'cancelled')
      run.abortController.abort()
    }
    this.activeRuns.clear()
    this.pendingInteractions.reject()
    discardAllTextBatches()
  }

  async abortAndWait(queryKey: string, timeoutMs = 6500): Promise<void> {
    const matchedKey = this.findRunKey(queryKey)
    const run = matchedKey ? this.activeRuns.get(matchedKey) : undefined
    this.abort(queryKey)
    if (!run) return

    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        run.completion,
        new Promise<void>((_resolve, reject) => {
          timeout = setTimeout(() => reject(new Error('Agent run did not stop in time')), timeoutMs)
        }),
      ])
    } finally {
      if (timeout) clearTimeout(timeout)
    }
  }

  async setPermissionMode(queryKey: string | undefined, mode: PermissionMode): Promise<boolean> {
    const matchedKey = queryKey ? this.findRunKey(queryKey) : this.findSingleActiveRunKey()
    if (!matchedKey) return false

    const run = this.activeRuns.get(matchedKey)
    if (!run) return false

    await run.query.setPermissionMode(mode)
    return true
  }

  handleWindowDestroy(): void {
    this.pendingInteractions.reject()
    discardAllTextBatches()
    this.generationProjector.cleanupAll()
  }

  cleanupRun(sessionId: string, instanceId: number): void {
    const current = this.activeRuns.get(sessionId)
    if (current && current.instanceId === instanceId) {
      discardTextBatch(sessionId)
      this.generationProjector.cleanup(sessionId)
      this.activeRuns.delete(sessionId)
      this.pendingInteractions.reject(sessionId)
    }
    this.completionResolvers.get(instanceId)?.()
    this.completionResolvers.delete(instanceId)
  }

  finalizeRun(win: BrowserWindow, sessionId: string, instanceId: number): void {
    if (this.activeRuns.get(sessionId)?.instanceId === instanceId) {
      this.flushText(sessionId, win)
    }
    this.cleanupRun(sessionId, instanceId)
  }

  private findRunKey(queryKey: string): string | null {
    if (this.activeRuns.has(queryKey)) return queryKey
    let contextMatch: string | null = null
    for (const [key, run] of this.activeRuns) {
      if (run.envelope.sdkSessionId === queryKey) return key
      if (run.envelope.context === queryKey) contextMatch = key
    }
    return contextMatch
  }

  private findSingleActiveRunKey(): string | null {
    if (this.activeRuns.size !== 1) return null
    return this.activeRuns.keys().next().value ?? null
  }

}

export const sessionRuntime = new SessionRuntimeController()

export function resolvePermission(
  requestId: string,
  behavior: 'allow' | 'deny',
  options?: PermissionResponseOptions
): void {
  sessionRuntime.resolvePermission(requestId, behavior, options)
}

export function resolveAskUser(requestId: string, answers: Record<string, string>): void {
  sessionRuntime.resolveAskUser(requestId, answers)
}
