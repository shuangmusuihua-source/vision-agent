import type { BrowserWindow } from 'electron'
import type { Query, SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import type {
  AgentIPCMessage,
  AgentSessionEnvelope,
  AskUserRequestIPC,
  PermissionRequestIPC,
} from '../shared/types'
import { createSessionEnvelope, withSessionEnvelope } from './session-envelope'
import { SkillOutputBridge } from './skill-output-bridge'
import {
  rejectAllPendingAskUser,
  rejectAllPendingPermissions,
} from './agent-permissions'
import {
  discardAllTextBatches,
  discardTextBatch,
  flushTextBatch,
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

  private findRunKey(queryKey: string): string | null {
    if (this.activeRuns.has(queryKey)) return queryKey
    for (const [key, run] of this.activeRuns) {
      if (run.envelope.sdkSessionId === queryKey) return key
    }
    return null
  }
}

export const sessionRuntime = new SessionRuntimeController()
