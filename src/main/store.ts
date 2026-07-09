// ─── Barrel facade — delegates to persistence/ sub-modules ──────────────
//
// store.ts was split into three deepened persistence adapters sharing
// one electron-store instance (persistence/store-core.ts):
//   persistence/profile-store.ts   — API key encryption, profile CRUD
//   persistence/workspace-store.ts — directories, workspaces, sessions, KB
//   persistence/settings-store.ts  — theme, cron, skills, compaction IDs
//
// This file exists for backward compatibility. New importers should prefer
// importing from the specific persistence/ adapter they need.

export type { AppSettings, CronTask } from './persistence/store-core'
export type { CronTaskRegistration, CronTaskTarget, CronTaskRun } from '../shared/cron-types'
export { getKnowledgeBaseDir } from './persistence/store-core'

export {
  getSettings,
  getActiveProfile,
  getApiKey,
  getBaseUrl,
  getModel,
  addProfile,
  updateProfile,
  removeProfile,
  setActiveProfile,
} from './persistence/profile-store'

export {
  getAuthorizedDirectories,
  addAuthorizedDirectory,
  removeAuthorizedDirectory,
  reorderAuthorizedDirectories,
  getFixedDirectories,
  getWorkspaces,
  setWorkspaces,
  getWorkspaceById,
  getWorkspaceByPath,
  addWorkspace,
  removeWorkspace,
  getSessionRecords,
  getSessionsByWorkspace,
  getSessionRecordById,
  addSessionRecord,
  removeSessionRecord,
  updateSessionRecord,
  ensureKnowledgeBase,
  getStoreVersion,
  setStoreVersion,
} from './persistence/workspace-store'

export {
  getTheme,
  setTheme,
  getCronTasks,
  saveCronTasks,
  getEnabledSkills,
  setEnabledSkills,
  toggleSkill,
  getCompactionSessionIds,
  addCompactionSessionId,
  deleteCompactionSessionId,
} from './persistence/settings-store'

export { getSessionFileOutputs } from './session-file-catalog'
