import { BrowserWindow } from 'electron'

let _mainWindow: BrowserWindow | null = null

/** Set the main window reference (called from index.ts after window creation). */
export function setMainWindow(win: BrowserWindow): void {
  _mainWindow = win
}

/** Get the main BrowserWindow, or null if not yet created / already destroyed. */
export function getMainWindow(): BrowserWindow | null {
  return _mainWindow
}
