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
  return state.pendingSaves[filePath]?.content ?? state.tabContents[filePath] ?? ''
}

export function pendingSaveFor(state: WorkspaceTabState | undefined, filePath: string): PendingSave | null {
  return state?.pendingSaves[filePath] ?? null
}

export function withSavedFile(
  state: WorkspaceTabState,
  filePath: string,
  content: string
): WorkspaceTabState {
  const pendingSaves = { ...state.pendingSaves }
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
      ...state.pendingSaves,
      [filePath]: { content, error },
    },
  }
}

export function withoutFileState(state: WorkspaceTabState, filePath: string): WorkspaceTabState {
  const tabContents = { ...state.tabContents }
  const pendingSaves = { ...state.pendingSaves }
  delete tabContents[filePath]
  delete pendingSaves[filePath]
  return { ...state, tabContents, pendingSaves }
}

export function withoutFilePrefixState(state: WorkspaceTabState, prefix: string): WorkspaceTabState {
  const tabContents = { ...state.tabContents }
  const pendingSaves = { ...state.pendingSaves }
  for (const key of Object.keys(tabContents)) {
    if (key.startsWith(prefix)) delete tabContents[key]
  }
  for (const key of Object.keys(pendingSaves)) {
    if (key.startsWith(prefix)) delete pendingSaves[key]
  }
  return { ...state, tabContents, pendingSaves }
}

export function withRenamedFile(
  state: WorkspaceTabState,
  from: string,
  to: string,
): WorkspaceTabState {
  if (from === to) return state
  const hasSource = state.tabs.some((tab) => tab.type === 'file' && tab.path === from)
    || (state.activeTab?.type === 'file' && state.activeTab.path === from)
    || Object.prototype.hasOwnProperty.call(state.tabContents, from)
    || Object.prototype.hasOwnProperty.call(state.pendingSaves, from)
  if (!hasSource) return state

  const seenFilePaths = new Set<string>()
  const tabs: TabDescriptor[] = []
  for (const tab of state.tabs) {
    const nextTab = tab.type === 'file' && tab.path === from
      ? { ...tab, path: to }
      : tab
    if (nextTab.type === 'file') {
      if (seenFilePaths.has(nextTab.path)) continue
      seenFilePaths.add(nextTab.path)
    }
    tabs.push(nextTab)
  }
  const activeTab = state.activeTab?.type === 'file' && state.activeTab.path === from
    ? { ...state.activeTab, path: to }
    : state.activeTab
  const tabContents = { ...state.tabContents }
  const pendingSaves = { ...state.pendingSaves }
  if (Object.prototype.hasOwnProperty.call(tabContents, from)) {
    tabContents[to] = tabContents[from]
    delete tabContents[from]
  }
  if (Object.prototype.hasOwnProperty.call(pendingSaves, from)) {
    pendingSaves[to] = pendingSaves[from]
    delete pendingSaves[from]
  }
  return { ...state, tabs, activeTab, tabContents, pendingSaves }
}
