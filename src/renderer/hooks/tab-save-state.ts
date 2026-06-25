import type { TabDescriptor } from '../../shared/types'

export type PendingSave = {
  content: string
  error: string
}

export type WorkspaceTabState = {
  tabs: TabDescriptor[]
  activeTab: TabDescriptor | null
  tabContents: Record<string, string>
  pendingSaves: Record<string, PendingSave>
}

export function createWorkspaceTabState(): WorkspaceTabState {
  return { tabs: [], activeTab: null, tabContents: {}, pendingSaves: {} }
}

export function visibleFileContent(state: WorkspaceTabState | undefined, filePath: string): string {
  if (!state) return ''
  return state.pendingSaves?.[filePath]?.content ?? state.tabContents[filePath] ?? ''
}

export function pendingSaveFor(state: WorkspaceTabState | undefined, filePath: string): PendingSave | null {
  return state?.pendingSaves?.[filePath] ?? null
}

export function withSavedFile(
  state: WorkspaceTabState,
  filePath: string,
  content: string
): WorkspaceTabState {
  const pendingSaves = { ...(state.pendingSaves ?? {}) }
  delete pendingSaves[filePath]
  return {
    ...state,
    tabContents: { ...state.tabContents, [filePath]: content },
    pendingSaves,
  }
}

export function withPendingSave(
  state: WorkspaceTabState,
  filePath: string,
  content: string,
  error: string
): WorkspaceTabState {
  return {
    ...state,
    pendingSaves: {
      ...(state.pendingSaves ?? {}),
      [filePath]: { content, error },
    },
  }
}

export function withoutFileState(state: WorkspaceTabState, filePath: string): WorkspaceTabState {
  const tabContents = { ...state.tabContents }
  const pendingSaves = { ...(state.pendingSaves ?? {}) }
  delete tabContents[filePath]
  delete pendingSaves[filePath]
  return { ...state, tabContents, pendingSaves }
}

export function withoutFilePrefixState(state: WorkspaceTabState, prefix: string): WorkspaceTabState {
  const tabContents = { ...state.tabContents }
  const pendingSaves = { ...(state.pendingSaves ?? {}) }
  for (const key of Object.keys(tabContents)) {
    if (key.startsWith(prefix)) delete tabContents[key]
  }
  for (const key of Object.keys(pendingSaves)) {
    if (key.startsWith(prefix)) delete pendingSaves[key]
  }
  return { ...state, tabContents, pendingSaves }
}
