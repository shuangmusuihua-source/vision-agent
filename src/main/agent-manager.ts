// ─── Barrel re-export — delegates to query-runner and session-store ────
//
// agent-manager was split into two deepened modules:
//   query-runner.ts  — sendMessage, abortActiveQuery, handleWindowDestroy,
//                      setGenerationWindow, buildOptions, hooks
//   session-store.ts — listSdkSessions, loadSdkSessionMessagesPaginated,
//                      renameSdkSession, deleteSdkSession, compaction tracking
//
// This file exists for backward compatibility. New importers should prefer
// importing from query-runner or session-store directly.

export {
  sendMessage,
  abortActiveQuery,
  abortActiveQueryAndWait,
  handleWindowDestroy,
  setPermissionMode,
  setGenerationWindow,
} from './query-runner'

export {
  listSdkSessions,
  loadSdkSessionMessagesPaginated,
  renameSdkSession,
  deleteSdkSession,
  getSdkSessionTotalMessageCount,
} from './session-store'

export { resolvePermission, resolveAskUser } from './session-runtime'
