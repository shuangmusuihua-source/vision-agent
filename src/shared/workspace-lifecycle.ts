export type WorkspaceCreateErrorCode =
  | 'invalid_name'
  | 'reserved_name'
  | 'already_exists'
  | 'filesystem_error'
  | 'persistence_error'

export type WorkspaceDeleteErrorCode =
  | 'not_registered'
  | 'reserved_workspace'
  | 'agent_stop_failed'
  | 'automation_stop_failed'
  | 'filesystem_error'
  | 'persistence_error'

export type WorkspaceCreateResult =
  | {
      success: true
      workspacePath: string
      workspacePaths: string[]
    }
  | {
      success: false
      code: WorkspaceCreateErrorCode
      error: string
      workspacePaths: string[]
    }

export type WorkspaceDeleteResult =
  | {
      success: true
      workspacePath: string
      workspacePaths: string[]
      removedSessionIds: string[]
      pausedTaskIds: string[]
    }
  | {
      success: false
      code: WorkspaceDeleteErrorCode
      error: string
      workspacePaths: string[]
    }

export type WorkspaceReorderResult =
  | {
      success: true
      workspacePaths: string[]
    }
  | {
      success: false
      code: 'invalid_order' | 'persistence_error'
      error: string
      workspacePaths: string[]
    }
