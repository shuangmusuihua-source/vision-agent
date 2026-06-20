import type { BrowserWindow } from 'electron'
import type { Query, SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import type { PermissionResult } from '@anthropic-ai/claude-agent-sdk'
import type {
  AgentIPCMessage,
  AgentSessionEnvelope,
  AskUserRequestIPC,
  PermissionRequestIPC,
} from '../shared/types'
import { createSessionEnvelope, withSessionEnvelope } from './session-envelope'
import { SkillOutputBridge } from './skill-output-bridge'
import { toAgentIPCMessage } from './message-converter'
import {
  deletePendingAskUser,
  deletePendingPermission,
  hasPendingAskUser,
  hasPendingPermission,
  registerPendingAskUser,
  registerPendingPermission,
  rejectAllPendingAskUser,
  rejectAllPendingPermissions,
} from './agent-permissions'
import {
  cancelPermissionNotification,
  schedulePermissionNotification,
} from './notification-manager'
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
}

export type SessionRuntimeStart = {
  query: Query
  skillId: string | null
  abortController: AbortController
  envelope: AgentSessionEnvelope
}

type PermissionRequestInput = Omit<PermissionRequestIPC, keyof AgentSessionEnvelope | 'id'>
type AskUserRequestInput = Omit<AskUserRequestIPC, keyof AgentSessionEnvelope | 'id'>

export { createSessionEnvelope, withSessionEnvelope } from './session-envelope'

export class SessionRuntimeController {
  private instanceCounter = 0
  private activeRuns = new Map<string, ActiveSessionRun>()
  private skillOutputBridge = new SkillOutputBridge()
  private skillOutputWindow: BrowserWindow | null = null

  constructor() {
    this.skillOutputBridge.setOutputEmitter((state) => {
      const win = this.skillOutputWindow
      if (!win || win.isDestroyed()) return
      win.webContents.send('skill:output', state)
    })
  }

  setSkillOutputWindow(win: BrowserWindow): void {
    this.skillOutputWindow = win
  }

  beginSession(envelope: AgentSessionEnvelope): void {
    this.skillOutputBridge.reset(envelope.sessionId, envelope)
  }

  registerRun(input: SessionRuntimeStart): number {
    const instanceId = ++this.instanceCounter
    this.activeRuns.set(input.envelope.sessionId, {
      query: input.query,
      skillId: input.skillId,
      abortController: input.abortController,
      instanceId,
      envelope: input.envelope,
    })
    return instanceId
  }

  getActiveSkillId(sessionId: string): string | null {
    return this.activeRuns.get(sessionId)?.skillId ?? null
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
    this.skillOutputBridge.setSessionEnvelope(sessionId, envelope)
    return envelope
  }

  processSkillRawEvent(sessionId: string, rawMessage: SDKMessage): void {
    const skillId = this.getActiveSkillId(sessionId)
    this.skillOutputBridge.processRawEvent(sessionId, rawMessage, skillId)
  }

  emitSdkMessage(
    win: BrowserWindow,
    sessionId: string,
    envelope: AgentSessionEnvelope,
    rawMessage: SDKMessage
  ): void {
    this.processSkillRawEvent(sessionId, rawMessage)

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
    win.webContents.send('agent:event', withSessionEnvelope(envelope, message as unknown as Record<string, unknown>))
  }

  emitExecutionError(win: BrowserWindow, envelope: AgentSessionEnvelope, message: string): void {
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
    win.webContents.send('agent:permissionRequest', withSessionEnvelope(envelope, request))
  }

  emitAskUserRequest(
    win: BrowserWindow,
    envelope: AgentSessionEnvelope,
    request: Omit<AskUserRequestIPC, keyof AgentSessionEnvelope>
  ): void {
    if (win.isDestroyed()) return
    win.webContents.send('agent:askUser', withSessionEnvelope(envelope, request))
  }

  emitPermissionTimeout(win: BrowserWindow, envelope: AgentSessionEnvelope, requestId: string): void {
    if (win.isDestroyed()) return
    win.webContents.send('agent:permissionTimeout', withSessionEnvelope(envelope, { requestId }))
  }

  emitAskUserTimeout(win: BrowserWindow, envelope: AgentSessionEnvelope, requestId: string): void {
    if (win.isDestroyed()) return
    win.webContents.send('agent:askUserTimeout', withSessionEnvelope(envelope, { requestId }))
  }

  requestAskUserAnswer(
    win: BrowserWindow,
    envelope: AgentSessionEnvelope,
    request: AskUserRequestInput,
    originalInput: Record<string, unknown>
  ): Promise<PermissionResult> {
    const requestId = this.createRequestId('ask')

    return new Promise<PermissionResult>((resolve) => {
      let settled = false
      const settle = (result: PermissionResult) => {
        if (settled) return
        settled = true
        resolve(result)
      }

      const timeout = setTimeout(() => {
        if (!hasPendingAskUser(requestId)) return
        deletePendingAskUser(requestId)
        this.emitAskUserTimeout(win, envelope, requestId)
        settle({ behavior: 'deny', message: 'AskUserQuestion timed out — user did not respond' })
      }, 300000)

      registerPendingAskUser(requestId, settle, originalInput, timeout, envelope.context, envelope.sessionId)
      this.emitAskUserRequest(win, envelope, {
        id: requestId,
        ...request,
      })
    })
  }

  requestPermissionApproval(
    win: BrowserWindow,
    envelope: AgentSessionEnvelope,
    request: PermissionRequestInput,
    signal?: AbortSignal
  ): Promise<PermissionResult> {
    const requestId = this.createRequestId('perm')

    return new Promise<PermissionResult>((resolve) => {
      let settled = false
      let abortHandler: (() => void) | null = null

      const settle = (result: PermissionResult) => {
        if (settled) return
        settled = true
        if (signal && abortHandler) {
          signal.removeEventListener('abort', abortHandler)
        }
        resolve(result)
      }

      const cleanup = () => {
        if (hasPendingPermission(requestId)) {
          deletePendingPermission(requestId)
          cancelPermissionNotification(requestId)
          clearTimeout(timeout)
        }
      }

      const timeout = setTimeout(() => {
        if (!hasPendingPermission(requestId)) return
        deletePendingPermission(requestId)
        cancelPermissionNotification(requestId)
        this.emitPermissionTimeout(win, envelope, requestId)
        settle({ behavior: 'deny', message: 'Permission request timed out' })
      }, 300000)

      registerPendingPermission(requestId, settle, request.input, timeout, envelope.context, envelope.sessionId)

      abortHandler = () => {
        cleanup()
        this.emitPermissionTimeout(win, envelope, requestId)
        settle({ behavior: 'deny', message: 'Tool use cancelled by SDK' })
      }

      if (signal) {
        if (signal.aborted) {
          abortHandler()
          return
        }
        signal.addEventListener('abort', abortHandler, { once: true })
      }

      this.emitPermissionRequest(win, envelope, {
        id: requestId,
        ...request,
      })
      schedulePermissionNotification(requestId, request.toolName)
    })
  }

  emitNotification(
    win: BrowserWindow,
    envelope: AgentSessionEnvelope,
    notification: { type: string; message: string; title: string }
  ): void {
    if (win.isDestroyed()) return
    win.webContents.send('agent:notification', {
      ...withSessionEnvelope(envelope, notification),
      workspaceCwd: envelope.workspacePath,
    })
  }

  abort(queryKey?: string): void {
    if (queryKey) {
      const matchedKey = this.findRunKey(queryKey)
      if (matchedKey) {
        const run = this.activeRuns.get(matchedKey)
        run?.abortController.abort()
        this.activeRuns.delete(matchedKey)
        rejectAllPendingPermissions(matchedKey)
        rejectAllPendingAskUser(matchedKey)
        discardTextBatch(matchedKey)
        return
      }

      rejectAllPendingPermissions(queryKey)
      rejectAllPendingAskUser(queryKey)
      discardTextBatch(queryKey)
      return
    }

    for (const [, run] of this.activeRuns) {
      run.abortController.abort()
    }
    this.activeRuns.clear()
    rejectAllPendingPermissions()
    rejectAllPendingAskUser()
    discardAllTextBatches()
  }

  handleWindowDestroy(): void {
    rejectAllPendingPermissions()
    rejectAllPendingAskUser()
    discardAllTextBatches()
  }

  cleanupRun(sessionId: string, instanceId: number): void {
    discardTextBatch(sessionId)
    this.skillOutputBridge.cleanup(sessionId)
    const current = this.activeRuns.get(sessionId)
    if (current && current.instanceId === instanceId) {
      this.activeRuns.delete(sessionId)
    }
    rejectAllPendingPermissions(sessionId)
    rejectAllPendingAskUser(sessionId)
  }

  finalizeRun(win: BrowserWindow, sessionId: string, instanceId: number): void {
    this.flushText(sessionId, win)
    this.cleanupRun(sessionId, instanceId)
  }

  private findRunKey(queryKey: string): string | null {
    if (this.activeRuns.has(queryKey)) return queryKey
    for (const [key, run] of this.activeRuns) {
      if (run.envelope.sdkSessionId === queryKey) return key
    }
    return null
  }

  private createRequestId(prefix: 'ask' | 'perm'): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  }
}

export const sessionRuntime = new SessionRuntimeController()
