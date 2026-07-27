import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { SessionOutputEntry, SessionOutputs } from '../../shared/types'
import { useAgentStore } from '../store/agent-store-impl'

export interface KnowledgeImportResult {
  success: boolean
  alreadyExists?: boolean
  updated?: boolean
  error?: string
}

interface SessionOutputWorkflowPort {
  getActiveSessionId: () => string | null
  list: (sessionId: string) => Promise<SessionOutputs | null>
  setOutputs: (outputs: SessionOutputs | null) => void
  setLoading: (loading: boolean) => void
  addToKnowledge: (filePath: string, sessionId: string) => Promise<KnowledgeImportResult>
  reveal: (sessionId: string, filePath: string) => Promise<{ success: boolean; error?: string }>
  open: (sessionId: string, filePath: string) => Promise<{ success: boolean; error?: string }>
  delete: (sessionId: string, filePath: string) => Promise<{ success: boolean; error?: string }>
  confirmDelete: (fileName: string) => Promise<boolean>
  alert: (title: string, message: string) => Promise<void>
}

/**
 * Owns the session-output lifecycle behind one interface: latest-request wins,
 * active-session routing, event debouncing, action feedback, and refreshes.
 */
export class SessionOutputWorkflow {
  private readonly requestVersions = new Map<string, number>()
  private readonly refreshTimers = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(
    private readonly port: SessionOutputWorkflowPort,
    private readonly refreshDelayMs = 120,
  ) {}

  activateSession(sessionId: string | null): void {
    if (!sessionId) {
      this.port.setOutputs(null)
      return
    }
    void this.refresh(sessionId, true)
  }

  sessionFilesChanged(sessionId: string): void {
    if (this.port.getActiveSessionId() === sessionId) {
      this.scheduleRefresh(sessionId)
    }
  }

  agentFinished(sessionId: string): void {
    this.scheduleRefresh(sessionId)
  }

  async addToKnowledge(filePath: string): Promise<KnowledgeImportResult> {
    const sessionId = this.port.getActiveSessionId()
    if (!sessionId) return { success: false, error: '没有活动会话' }

    const result = await this.port.addToKnowledge(filePath, sessionId)
    if (!result.success) {
      await this.port.alert('无法放入知识库', result.error || '请稍后重试')
    } else {
      await this.refresh(sessionId)
    }
    return result
  }

  async reveal(filePath: string): Promise<void> {
    const sessionId = this.port.getActiveSessionId()
    if (!sessionId) return

    const result = await this.port.reveal(sessionId, filePath)
    if (!result.success) {
      await this.port.alert('无法打开所在目录', result.error || '产物可能已被移动或删除')
    }
  }

  async open(filePath: string): Promise<void> {
    const sessionId = this.port.getActiveSessionId()
    if (!sessionId) return

    const result = await this.port.open(sessionId, filePath)
    if (!result.success) {
      await this.port.alert('无法打开产物', result.error || '没有可用于打开该文件的应用')
    }
  }

  async delete(file: SessionOutputEntry): Promise<boolean> {
    const sessionId = this.port.getActiveSessionId()
    if (!sessionId || !await this.port.confirmDelete(file.fileName)) return false

    const result = await this.port.delete(sessionId, file.filePath)
    if (!result.success) {
      await this.port.alert('删除失败', result.error || '请稍后重试')
      return false
    }
    await this.refresh(sessionId)
    return true
  }

  dispose(): void {
    for (const timer of this.refreshTimers.values()) clearTimeout(timer)
    this.refreshTimers.clear()
  }

  private scheduleRefresh(sessionId: string): void {
    const existing = this.refreshTimers.get(sessionId)
    if (existing) clearTimeout(existing)
    const timer = setTimeout(() => {
      this.refreshTimers.delete(sessionId)
      void this.refresh(sessionId)
    }, this.refreshDelayMs)
    this.refreshTimers.set(sessionId, timer)
  }

  private async refresh(sessionId: string, showLoading = false): Promise<void> {
    const requestVersion = (this.requestVersions.get(sessionId) || 0) + 1
    this.requestVersions.set(sessionId, requestVersion)
    if (showLoading) this.port.setLoading(true)

    try {
      const outputs = await this.port.list(sessionId)
      if (this.canProject(sessionId, requestVersion)) {
        this.port.setOutputs(outputs)
      }
    } catch {
      if (this.canProject(sessionId, requestVersion)) {
        this.port.setOutputs(null)
      }
    }
  }

  private canProject(sessionId: string, requestVersion: number): boolean {
    return this.requestVersions.get(sessionId) === requestVersion
      && this.port.getActiveSessionId() === sessionId
  }
}

interface UseSessionOutputWorkflowOptions {
  activeSessionId: string | null
  isStreaming: boolean
  alert: (options: { title: string; message: string }) => Promise<void>
  confirm: (options: {
    title: string
    message: string
    variant?: 'danger'
    confirmLabel?: string
  }) => Promise<boolean>
}

export function useSessionOutputWorkflow({
  activeSessionId,
  isStreaming,
  alert,
  confirm,
}: UseSessionOutputWorkflowOptions): {
  addToKnowledge: (filePath: string) => Promise<KnowledgeImportResult>
  reveal: (filePath: string) => Promise<void>
  open: (filePath: string) => Promise<void>
  delete: (file: SessionOutputEntry) => Promise<boolean>
} {
  const workflow = useMemo(() => new SessionOutputWorkflow({
    getActiveSessionId: () => useAgentStore.getState().activeSessionId.editor,
    list: (sessionId) => window.api.agent.getSessionOutputs(sessionId),
    setOutputs: (outputs) => useAgentStore.getState().setSessionOutputs(outputs),
    setLoading: (loading) => useAgentStore.getState().setSessionOutputsLoading(loading),
    addToKnowledge: (filePath, sessionId) => window.api.workspace.addToKnowledge(filePath, sessionId),
    reveal: (sessionId, filePath) => window.api.agent.revealSessionOutput(sessionId, filePath),
    open: (sessionId, filePath) => window.api.agent.openSessionOutput(sessionId, filePath),
    delete: (sessionId, filePath) => window.api.agent.deleteSessionOutput(sessionId, filePath),
    confirmDelete: (fileName) => confirm({
      title: '删除产物',
      message: `确定删除“${fileName}”吗？文件会被移到废纸篓。`,
      variant: 'danger',
      confirmLabel: '删除',
    }),
    alert: (title, message) => alert({ title, message }),
  }), [alert, confirm])
  const previousStreaming = useRef(isStreaming)

  useEffect(() => {
    workflow.activateSession(activeSessionId)
  }, [activeSessionId, workflow])

  useEffect(() => {
    return window.api.agent.onSessionFilesChanged(({ sessionId }) => {
      workflow.sessionFilesChanged(sessionId)
    })
  }, [workflow])

  useEffect(() => {
    const wasStreaming = previousStreaming.current
    previousStreaming.current = isStreaming
    if (!wasStreaming || isStreaming) return

    const state = useAgentStore.getState()
    const sessionId = state.activeSessionId.editor
    if (sessionId && state.slots.editor.messages.length > 0) {
      workflow.agentFinished(sessionId)
    }
  }, [isStreaming, workflow])

  useEffect(() => () => workflow.dispose(), [workflow])

  return {
    addToKnowledge: useCallback((filePath) => workflow.addToKnowledge(filePath), [workflow]),
    reveal: useCallback((filePath) => workflow.reveal(filePath), [workflow]),
    open: useCallback((filePath) => workflow.open(filePath), [workflow]),
    delete: useCallback((file) => workflow.delete(file), [workflow]),
  }
}
