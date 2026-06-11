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

/** Send an IPC message to the renderer. No-op if window is null or destroyed. */
export function sendIpc(channel: string, ...args: unknown[]): void {
  if (_mainWindow && !_mainWindow.isDestroyed()) {
    _mainWindow.webContents.send(channel, ...args)
  }
}
