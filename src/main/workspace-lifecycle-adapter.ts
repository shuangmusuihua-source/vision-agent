import { app, shell } from 'electron'
import { mkdir, rmdir } from 'fs/promises'
import { join } from 'path'
import { DOCUMENTS_DIR_NAME } from '../shared/branding'
import { isReservedKnowledgeWorkspacePath } from '../shared/workspace-paths'
import { suspendTasksForWorkspace } from './cron-manager'
import { fileIndexService } from './file-index-service'
import { findAuthorizedWorkspaceRoot } from './path-validator'
import {
  addAuthorizedDirectory,
  getAuthorizedDirectories,
  removeWorkspacePersistence,
  reorderAuthorizedDirectories,
} from './persistence/workspace-store'
import { getKnowledgeBaseDir } from './persistence/store-core'
import { sessionRuntime } from './session-runtime'
import { WorkspaceLifecycle } from './workspace-lifecycle'

export function createWorkspaceLifecycle(
  notifySettingsChanged: () => void,
): WorkspaceLifecycle {
  return new WorkspaceLifecycle({
    documentsRoot: () => join(app.getPath('documents'), DOCUMENTS_DIR_NAME),
    ensureDirectory: async (directoryPath) => {
      await mkdir(directoryPath, { recursive: true })
    },
    createDirectory: async (directoryPath) => {
      await mkdir(directoryPath)
    },
    removeEmptyDirectory: async (directoryPath) => {
      await rmdir(directoryPath)
    },
    trashWorkspace: async (workspacePath) => {
      await shell.trashItem(workspacePath)
    },
    findRegisteredRoot: findAuthorizedWorkspaceRoot,
    isReservedWorkspace: (workspacePath) => (
      isReservedKnowledgeWorkspacePath(workspacePath, [getKnowledgeBaseDir()])
    ),
    getWorkspacePaths: getAuthorizedDirectories,
    addWorkspace: addAuthorizedDirectory,
    removeWorkspace: removeWorkspacePersistence,
    reorderWorkspaces: reorderAuthorizedDirectories,
    abortWorkspaceRuns: (workspacePath) => sessionRuntime.abortWorkspaceAndWait(workspacePath),
    suspendWorkspaceTasks: suspendTasksForWorkspace,
    refreshIndex: (workspacePaths) => fileIndexService.init(workspacePaths),
    notifySettingsChanged,
  })
}
