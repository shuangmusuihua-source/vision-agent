import { create } from 'zustand'

export type PrimaryView = 'ask' | 'editor'

interface UpdateInfo { version: string }

interface UiSlice {
  // ── View routing ─────────────────────────────────────────────────
  view: PrimaryView
  setView: (view: PrimaryView) => void

  // ── Linked file (editor → agent context) ─────────────────────────
  linkedFile: string | null
  setLinkedFile: (path: string | null) => void

  // ── Search ───────────────────────────────────────────────────────
  showSearch: boolean
  searchQuery: string
  openSearch: (query?: string) => void
  closeSearch: () => void

  // ── Editor modes ─────────────────────────────────────────────────
  sourceMode: boolean
  setSourceMode: (v: boolean) => void
  focusMode: boolean
  setFocusMode: (v: boolean) => void
  editorStats: { words: number; chars: number }
  setEditorStats: (stats: { words: number; chars: number }) => void

  // ── Update banner ────────────────────────────────────────────────
  updateAvailable: UpdateInfo | null
  setUpdateAvailable: (info: UpdateInfo | null) => void
  updateDownloaded: boolean
  setUpdateDownloaded: (v: boolean) => void
  updateError: string | null
  setUpdateError: (error: string | null) => void

  // ── Error banner ─────────────────────────────────────────────────
  mainError: string | null
  setMainError: (error: string | null) => void

  // ── Daydream overlay ─────────────────────────────────────────────
  showDaydream: boolean
  daydreamMode: string
  openDaydream: (mode: string) => void
  closeDaydream: () => void

  // ── New session modal ────────────────────────────────────────────
  creatingSessionIn: string | null
  setCreatingSessionIn: (wsPath: string | null) => void
  newSessionName: string
  setNewSessionName: (name: string) => void
}

export const useUiStore = create<UiSlice>((set) => ({
  view: 'ask',
  setView: (view) => set({ view }),

  linkedFile: null,
  setLinkedFile: (linkedFile) => set({ linkedFile }),

  showSearch: false,
  searchQuery: '',
  openSearch: (query) => set({ showSearch: true, searchQuery: query || '' }),
  closeSearch: () => set({ showSearch: false, searchQuery: '' }),

  sourceMode: false,
  setSourceMode: (sourceMode) => set({ sourceMode }),
  focusMode: false,
  setFocusMode: (focusMode) => set({ focusMode }),
  editorStats: { words: 0, chars: 0 },
  setEditorStats: (editorStats) => set({ editorStats }),

  updateAvailable: null,
  setUpdateAvailable: (updateAvailable) => set({ updateAvailable }),
  updateDownloaded: false,
  setUpdateDownloaded: (updateDownloaded) => set({ updateDownloaded }),
  updateError: null,
  setUpdateError: (updateError) => set({ updateError }),

  mainError: null,
  setMainError: (mainError) => set({ mainError }),

  showDaydream: false,
  daydreamMode: 'matrix',
  openDaydream: (daydreamMode) => set({ showDaydream: true, daydreamMode }),
  closeDaydream: () => set({ showDaydream: false }),

  creatingSessionIn: null,
  setCreatingSessionIn: (creatingSessionIn) => set({ creatingSessionIn }),
  newSessionName: '',
  setNewSessionName: (newSessionName) => set({ newSessionName }),
}))
