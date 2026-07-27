import { useCallback, useEffect, useRef } from 'react'
import type { PrimaryView } from '../store/ui-slice'
import { useUiStore } from '../store/ui-slice'
import { useShallow } from 'zustand/react/shallow'
import type { TabDescriptor } from '../../shared/types'
import { OVERVIEW_TAB_ID } from '../../shared/types'
import { useAgentStore } from '../store/agent-store-impl'

interface EditorSessionWorkflowPort {
  getActiveWorkspacePath: () => string | null
  getActiveSessionId: () => string | null
  getView: () => PrimaryView
  loadSessions: () => Promise<void>
  persistNewSession: (
    sessionId: string,
    title: string,
    workspacePath: string,
  ) => Promise<{ success: boolean }>
  renameSession: (sessionId: string, title: string) => Promise<{ success: boolean }>
  deleteSdkSession: (sessionId: string) => Promise<{ success: boolean }>
  removeSessionRecord: (sessionId: string) => Promise<{ success: boolean }>
  resolveSdkSessionId: (sessionId: string) => string | null
  switchToSession: (sessionId: string, workspacePath?: string | null) => void
  setActiveWorkspace: (workspacePath: string) => void
  clearEditorLinkedFile: () => void
  restoreSessionLinkedFile: () => void
  addTemporarySession: (sessionId: string, title: string, workspacePath: string) => void
  renameSessionInList: (sessionId: string, title: string) => void
  removeSessionState: (sessionId: string) => void
  clearSessionOutputs: () => void
  showEditor: () => void
  selectExistingOverview: () => void
  openOverview: () => void
  finishDraft: () => void
  confirmDelete: () => Promise<boolean>
  alert: (title: string, message: string) => Promise<void>
  createTemporarySessionId: () => string
  logError: (operation: string, error: unknown) => void
}

/**
 * Owns editor-session routing and persistence ordering. App-owned records become
 * visible only after persistence succeeds, while SDK-backed and temporary
 * sessions share the same selection, rename, and removal interface.
 */
export class EditorSessionWorkflow {
  private creatingSession = false
  private skipNextWorkspaceLoad = false

  constructor(private readonly port: EditorSessionWorkflowPort) {}

  workspaceActivated(): void {
    if (this.skipNextWorkspaceLoad) {
      this.skipNextWorkspaceLoad = false
      return
    }
    void this.port.loadSessions()
  }

  sessionActivated(): void {
    if (
      this.port.getActiveWorkspacePath()
      && this.port.getActiveSessionId()
      && this.port.getView() === 'editor'
    ) {
      this.port.openOverview()
    }
  }

  select(sessionId: string, workspacePath: string): void {
    this.port.switchToSession(sessionId, workspacePath || null)
    this.port.restoreSessionLinkedFile()
    if (workspacePath && workspacePath !== this.port.getActiveWorkspacePath()) {
      this.port.setActiveWorkspace(workspacePath)
    }
    this.port.showEditor()
    this.port.selectExistingOverview()
  }

  async create(workspacePath: string, rawTitle: string): Promise<boolean> {
    const title = rawTitle.trim()
    if (!title || this.creatingSession) return false

    this.creatingSession = true
    const sessionId = this.port.createTemporarySessionId()
    try {
      const result = await this.port.persistNewSession(sessionId, title, workspacePath)
      if (!result.success) throw new Error('session record was not persisted')
    } catch (error) {
      this.port.logError('create session', error)
      await this.port.alert('创建失败', '无法保存新会话，请稍后重试')
      return false
    } finally {
      this.creatingSession = false
    }

    if (workspacePath !== this.port.getActiveWorkspacePath()) {
      this.skipNextWorkspaceLoad = true
    }
    this.port.switchToSession(sessionId, workspacePath)
    this.port.clearEditorLinkedFile()
    if (workspacePath !== this.port.getActiveWorkspacePath()) {
      this.port.setActiveWorkspace(workspacePath)
    }
    this.port.addTemporarySession(sessionId, title, workspacePath)
    this.port.finishDraft()
    this.port.showEditor()
    return true
  }

  async remove(sessionId: string): Promise<boolean> {
    if (!await this.port.confirmDelete()) return false

    const wasActive = this.port.getActiveSessionId() === sessionId
    const sdkSessionId = this.port.resolveSdkSessionId(sessionId)
    try {
      const result = sdkSessionId
        ? await this.port.deleteSdkSession(sdkSessionId)
        : await this.port.removeSessionRecord(sessionId)
      if (!result.success) throw new Error('session removal was rejected')
    } catch (error) {
      this.port.logError('delete session', error)
      await this.port.alert('删除失败', '无法删除会话，请稍后重试')
      return false
    }

    this.port.removeSessionState(sessionId)
    if (wasActive) {
      this.port.switchToSession('')
      this.port.clearSessionOutputs()
      this.port.clearEditorLinkedFile()
      this.port.showEditor()
    }
    return true
  }

  async rename(sessionId: string, title: string): Promise<boolean> {
    try {
      const result = await this.port.renameSession(sessionId, title)
      if (!result.success) throw new Error('session title was not persisted')
      this.port.renameSessionInList(sessionId, title)
      return true
    } catch (error) {
      this.port.logError('rename session', error)
      await this.port.alert('重命名失败', '无法保存会话名称，请稍后重试')
      return false
    }
  }
}

interface UseEditorSessionWorkflowOptions {
  activeWorkspacePath: string | null
  activeSessionId: string | null
  view: PrimaryView
  openTabs: TabDescriptor[]
  loadSessions: () => Promise<void>
  switchTab: (tab: TabDescriptor) => void
  openFixedTab: (tabId: string) => void
  setView: (view: PrimaryView) => void
  setAgentContext: (context: 'editor') => void
  setUiLinkedFile: (filePath: string | null) => void
  clearEditorLinkedFile: () => void
  alert: (options: { title: string; message: string }) => Promise<void>
  confirm: (options: {
    title: string
    message: string
    variant?: 'danger'
  }) => Promise<boolean>
}

export function useEditorSessionWorkflow(options: UseEditorSessionWorkflowOptions): {
  select: (sessionId: string, workspacePath: string) => void
  remove: (sessionId: string) => Promise<boolean>
  rename: (sessionId: string, title: string) => Promise<void>
  draft: {
    workspacePath: string | null
    title: string
    inputRef: React.RefObject<HTMLInputElement | null>
    begin: (workspacePath: string) => void
    cancel: () => void
    change: (title: string) => void
    submit: (workspacePath: string) => void
  }
} {
  const optionsRef = useRef(options)
  optionsRef.current = options
  const {
    creatingSessionIn,
    setCreatingSessionIn,
    newSessionName,
    setNewSessionName,
  } = useUiStore(useShallow((state) => ({
    creatingSessionIn: state.creatingSessionIn,
    setCreatingSessionIn: state.setCreatingSessionIn,
    newSessionName: state.newSessionName,
    setNewSessionName: state.setNewSessionName,
  })))
  const draftRef = useRef({ newSessionName, setCreatingSessionIn })
  draftRef.current = { newSessionName, setCreatingSessionIn }
  const inputRef = useRef<HTMLInputElement>(null)
  const workflowRef = useRef<EditorSessionWorkflow | null>(null)

  if (!workflowRef.current) {
    workflowRef.current = new EditorSessionWorkflow({
      getActiveWorkspacePath: () => useAgentStore.getState().activeWorkspacePath,
      getActiveSessionId: () => useAgentStore.getState().activeSessionId.editor,
      getView: () => optionsRef.current.view,
      loadSessions: () => optionsRef.current.loadSessions(),
      persistNewSession: (sessionId, title, workspacePath) => (
        window.api.agent.updateSessionRecord(sessionId, {
          title,
          workspacePath,
          context: 'editor',
        })
      ),
      renameSession: (sessionId, title) => window.api.agent.renameSession(sessionId, title),
      deleteSdkSession: (sessionId) => window.api.agent.deleteSession(sessionId),
      removeSessionRecord: (sessionId) => window.api.agent.removeSessionRecord(sessionId),
      resolveSdkSessionId: (sessionId) => {
        const state = useAgentStore.getState()
        return state.sessionSlots[sessionId]?.sdkSessionId
          || state.sessionList.find((session) => session.id === sessionId)?.sdkSessionId
          || (sessionId.startsWith('new-') ? null : sessionId)
      },
      switchToSession: (sessionId, workspacePath) => (
        useAgentStore.getState().switchToSession(sessionId, 'editor', workspacePath)
      ),
      setActiveWorkspace: (workspacePath) => useAgentStore.getState().setActiveWorkspace(workspacePath),
      clearEditorLinkedFile: () => optionsRef.current.clearEditorLinkedFile(),
      restoreSessionLinkedFile: () => {
        optionsRef.current.setUiLinkedFile(useAgentStore.getState().slots.editor.linkedFile || null)
      },
      addTemporarySession: (sessionId, title, workspacePath) => {
        useAgentStore.getState().dispatchSessionList({
          type: 'CREATE_TEMP',
          sessionId,
          title,
          workspacePath,
        })
      },
      renameSessionInList: (sessionId, title) => {
        useAgentStore.getState().dispatchSessionList({ type: 'RENAME', sessionId, title })
      },
      removeSessionState: (sessionId) => useAgentStore.getState().removeSessionState(sessionId),
      clearSessionOutputs: () => useAgentStore.getState().setSessionOutputs(null),
      showEditor: () => {
        if (optionsRef.current.view !== 'editor') {
          optionsRef.current.setAgentContext('editor')
          optionsRef.current.setView('editor')
        }
      },
      selectExistingOverview: () => {
        const tab = optionsRef.current.openTabs.find(
          (candidate) => candidate.type === 'fixed' && candidate.id === OVERVIEW_TAB_ID,
        )
        if (tab) optionsRef.current.switchTab(tab)
      },
      openOverview: () => optionsRef.current.openFixedTab(OVERVIEW_TAB_ID),
      finishDraft: () => draftRef.current.setCreatingSessionIn(null),
      confirmDelete: () => optionsRef.current.confirm({
        title: '删除会话',
        message: '确定删除此会话？会话中的对话记录和会话文件将被永久删除，此操作不可撤销。',
        variant: 'danger',
      }),
      alert: (title, message) => optionsRef.current.alert({ title, message }),
      createTemporarySessionId: () => `new-${Date.now()}`,
      logError: (operation, error) => console.error(`[EditorSessionWorkflow] ${operation} failed:`, error),
    })
  }

  const workflow = workflowRef.current

  useEffect(() => {
    workflow.workspaceActivated()
  }, [options.activeWorkspacePath, workflow])

  useEffect(() => {
    workflow.sessionActivated()
  }, [options.activeSessionId, options.activeWorkspacePath, options.view, workflow])

  useEffect(() => {
    if (!creatingSessionIn) return
    setNewSessionName('')
    const timer = setTimeout(() => inputRef.current?.focus(), 50)
    return () => clearTimeout(timer)
  }, [creatingSessionIn, setNewSessionName])

  return {
    select: useCallback(
      (sessionId, workspacePath) => workflow.select(sessionId, workspacePath),
      [workflow],
    ),
    remove: useCallback((sessionId) => workflow.remove(sessionId), [workflow]),
    rename: useCallback(async (sessionId, title) => {
      await workflow.rename(sessionId, title)
    }, [workflow]),
    draft: {
      workspacePath: creatingSessionIn,
      title: newSessionName,
      inputRef,
      begin: setCreatingSessionIn,
      cancel: () => setCreatingSessionIn(null),
      change: setNewSessionName,
      submit: (workspacePath) => {
        void workflow.create(workspacePath, draftRef.current.newSessionName)
      },
    },
  }
}
