// ─── Barrel re-export — delegates to query-runner and session-store ────
//
// agent-manager was split into two deepened modules:
//   query-runner.ts  — sendMessage, abortActiveQuery, handleWindowDestroy,
//                      setSkillOutputWindow, buildOptions, hooks
//   session-store.ts — listSdkSessions, loadSdkSessionMessages,
//                      renameSdkSession, deleteSdkSession, compaction tracking
//
// This file exists for backward compatibility. New importers should prefer
// importing from query-runner or session-store directly.

export {
  sendMessage,
  abortActiveQuery,
  handleWindowDestroy,
  setSkillOutputWindow,
} from './query-runner'

export {
  listSdkSessions,
  loadSdkSessionMessages,
  loadSdkSessionMessagesPaginated,
  renameSdkSession,
  deleteSdkSession,
  getSdkSessionTotalMessageCount,
  tagSdkSession,
  getSdkSessionInfo,
  forkSdkSession,
  loadSdkSessionMessagesTyped,
} from './session-store'

// These are still owned by their original modules; re-exported for compatibility
export { getSessionInfo, type SessionInfo } from './agent-sessions'
export { registerSession } from './agent-sessions'
export { resolvePermission, resolveAskUser } from './agent-permissions'
