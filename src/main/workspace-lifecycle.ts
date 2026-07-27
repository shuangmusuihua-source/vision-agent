import { join } from 'path'
import { isSameWorkspacePath, KNOWLEDGE_BASE_NAME } from '../shared/workspace-paths'
import type {
  WorkspaceCreateResult,
  WorkspaceDeleteResult,
  WorkspaceReorderResult,
} from '../shared/workspace-lifecycle'

export interface WorkspaceAutomationSuspension {
  taskIds: string[]
  commitDeletion: () => void
  rollback: () => void
}

export interface WorkspaceLifecycleDependencies {
  documentsRoot: () => string
  ensureDirectory: (directoryPath: string) => Promise<void>
  createDirectory: (directoryPath: string) => Promise<void>
  removeEmptyDirectory: (directoryPath: string) => Promise<void>
  trashWorkspace: (workspacePath: string) => Promise<void>
  findRegisteredRoot: (workspacePath: string) => string | null
  isReservedWorkspace: (workspacePath: string) => boolean
  getWorkspacePaths: () => string[]
  addWorkspace: (workspacePath: string) => void
  removeWorkspace: (workspacePath: string) => { removedSessionIds: string[] }
  reorderWorkspaces: (workspacePaths: string[]) => boolean
  abortWorkspaceRuns: (workspacePath: string) => Promise<string[]>
  suspendWorkspaceTasks: (workspacePath: string) => Promise<WorkspaceAutomationSuspension>
  refreshIndex: (workspacePaths: string[]) => Promise<void>
  notifySettingsChanged: () => void
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code)
    : undefined
}

/**
 * Owns all mutations of the registered Workspace collection.
 *
 * Callers cross one serialized Interface. Runtime shutdown, automation
 * suspension, filesystem mutation, persistence, indexing, and Renderer
 * projection remain implementation details behind this seam.
 */
export class WorkspaceLifecycle {
  private mutationTail: Promise<void> = Promise.resolve()
  private inFlightCreations = new Map<string, Promise<WorkspaceCreateResult>>()
  private inFlightDeletions = new Map<string, Promise<WorkspaceDeleteResult>>()

  constructor(private readonly dependencies: WorkspaceLifecycleDependencies) {}

  create(name: string): Promise<WorkspaceCreateResult> {
    const key = name.trim()
    const existing = this.inFlightCreations.get(key)
    if (existing) return existing

    const operation = this.enqueue(() => this.performCreate(name))
    let tracked!: Promise<WorkspaceCreateResult>
    const clearCreation = () => {
      if (this.inFlightCreations.get(key) === tracked) {
        this.inFlightCreations.delete(key)
      }
    }
    tracked = operation.then(
      (result) => { clearCreation(); return result },
      (error) => { clearCreation(); throw error },
    )
    this.inFlightCreations.set(key, tracked)
    return tracked
  }

  delete(workspacePath: string): Promise<WorkspaceDeleteResult> {
    const key = workspacePath.trim()
    const existing = Array.from(this.inFlightDeletions.entries())
      .find(([candidate]) => isSameWorkspacePath(candidate, key))?.[1]
    if (existing) return existing

    const operation = this.enqueue(() => this.performDelete(workspacePath))
    let tracked!: Promise<WorkspaceDeleteResult>
    const clearDeletion = () => {
      if (this.inFlightDeletions.get(key) === tracked) {
        this.inFlightDeletions.delete(key)
      }
    }
    tracked = operation.then(
      (result) => { clearDeletion(); return result },
      (error) => { clearDeletion(); throw error },
    )
    this.inFlightDeletions.set(key, tracked)
    return tracked
  }

  reorder(workspacePaths: string[]): Promise<WorkspaceReorderResult> {
    return this.enqueue(() => this.performReorder(workspacePaths))
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationTail.then(operation, operation)
    this.mutationTail = result.then(() => undefined, () => undefined)
    return result
  }

  private async performCreate(name: string): Promise<WorkspaceCreateResult> {
    const trimmedName = name.trim()
    const safeName = trimmedName.replace(/[/\\]/g, '').replace(/\.\./g, '')
    if (!safeName || safeName !== trimmedName) {
      return this.createFailure('invalid_name', '工作区名称无效')
    }
    if (safeName === KNOWLEDGE_BASE_NAME) {
      return this.createFailure('reserved_name', '该名称由系统工作区保留')
    }

    const documentsRoot = this.dependencies.documentsRoot()
    const workspacePath = join(documentsRoot, safeName)
    try {
      await this.dependencies.ensureDirectory(documentsRoot)
      // Deliberately non-recursive: EEXIST is the atomic ownership decision.
      await this.dependencies.createDirectory(workspacePath)
    } catch (error) {
      if (errorCode(error) === 'EEXIST') {
        return this.createFailure('already_exists', '工作区已存在，请使用其他名称')
      }
      return this.createFailure('filesystem_error', `创建工作区失败：${errorMessage(error)}`)
    }

    try {
      this.dependencies.addWorkspace(workspacePath)
    } catch (error) {
      await this.dependencies.removeEmptyDirectory(workspacePath).catch(() => undefined)
      return this.createFailure('persistence_error', `保存工作区失败：${errorMessage(error)}`)
    }

    await this.refreshIndex()
    this.dependencies.notifySettingsChanged()
    return {
      success: true,
      workspacePath,
      workspacePaths: this.dependencies.getWorkspacePaths(),
    }
  }

  private async performDelete(workspacePath: string): Promise<WorkspaceDeleteResult> {
    const registeredRoot = this.dependencies.findRegisteredRoot(workspacePath)
    if (!registeredRoot) {
      return this.deleteFailure('not_registered', '该工作区不存在或已从工作区列表移除')
    }
    if (this.dependencies.isReservedWorkspace(registeredRoot)) {
      return this.deleteFailure('reserved_workspace', '系统工作区不能删除')
    }

    try {
      await this.dependencies.abortWorkspaceRuns(registeredRoot)
    } catch (error) {
      return this.deleteFailure(
        'agent_stop_failed',
        `工作区中的 Agent 未能安全停止：${errorMessage(error)}`,
      )
    }

    let taskSuspension: WorkspaceAutomationSuspension
    try {
      taskSuspension = await this.dependencies.suspendWorkspaceTasks(registeredRoot)
    } catch (error) {
      return this.deleteFailure(
        'automation_stop_failed',
        `工作区中的自动化任务未能安全停止：${errorMessage(error)}`,
      )
    }

    try {
      await this.dependencies.trashWorkspace(registeredRoot)
    } catch (error) {
      try {
        taskSuspension.rollback()
      } catch (rollbackError) {
        console.error('[WorkspaceLifecycle] automation rollback failed:', rollbackError)
      }
      return this.deleteFailure(
        'filesystem_error',
        `无法将工作区移到废纸篓：${errorMessage(error)}`,
      )
    }

    let removedSessionIds: string[]
    try {
      removedSessionIds = this.dependencies.removeWorkspace(registeredRoot).removedSessionIds
    } catch (error) {
      try {
        taskSuspension.commitDeletion()
      } catch (commitError) {
        console.error('[WorkspaceLifecycle] automation deletion commit failed:', commitError)
      }
      return this.deleteFailure(
        'persistence_error',
        `工作区已移到废纸篓，但应用状态清理失败：${errorMessage(error)}`,
      )
    }

    try {
      taskSuspension.commitDeletion()
    } catch (error) {
      // Tasks were already stopped and persisted as paused by suspension.
      // A missing explanatory lastError must not make a completed deletion fail.
      console.error('[WorkspaceLifecycle] automation deletion commit failed:', error)
    }
    await this.refreshIndex()
    this.dependencies.notifySettingsChanged()
    return {
      success: true,
      workspacePath: registeredRoot,
      workspacePaths: this.dependencies.getWorkspacePaths(),
      removedSessionIds,
      pausedTaskIds: taskSuspension.taskIds,
    }
  }

  private async performReorder(workspacePaths: string[]): Promise<WorkspaceReorderResult> {
    try {
      if (!this.dependencies.reorderWorkspaces(workspacePaths)) {
        return {
          success: false,
          code: 'invalid_order',
          error: '工作区列表已发生变化，请重试',
          workspacePaths: this.dependencies.getWorkspacePaths(),
        }
      }
    } catch (error) {
      return {
        success: false,
        code: 'persistence_error',
        error: `保存工作区顺序失败：${errorMessage(error)}`,
        workspacePaths: this.dependencies.getWorkspacePaths(),
      }
    }

    await this.refreshIndex()
    this.dependencies.notifySettingsChanged()
    return {
      success: true,
      workspacePaths: this.dependencies.getWorkspacePaths(),
    }
  }

  private createFailure(
    code: Extract<WorkspaceCreateResult, { success: false }>['code'],
    error: string,
  ): WorkspaceCreateResult {
    return {
      success: false,
      code,
      error,
      workspacePaths: this.dependencies.getWorkspacePaths(),
    }
  }

  private deleteFailure(
    code: Extract<WorkspaceDeleteResult, { success: false }>['code'],
    error: string,
  ): WorkspaceDeleteResult {
    return {
      success: false,
      code,
      error,
      workspacePaths: this.dependencies.getWorkspacePaths(),
    }
  }

  private async refreshIndex(): Promise<void> {
    try {
      await this.dependencies.refreshIndex(this.dependencies.getWorkspacePaths())
    } catch (error) {
      console.error('[WorkspaceLifecycle] index refresh failed:', error)
    }
  }
}
