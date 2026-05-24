import { app, BrowserWindow, ipcMain, shell, nativeTheme } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import * as Sentry from '@sentry/electron/main'
import { registerIpcHandlers } from './ipc-handlers'
import { setupMenu } from './menu'
import { getSettings, getAuthorizedDirectories } from './store'
import { fileIndexService } from './file-index-service'
import { initAppSkills } from './skill-init'
import { restorePersistedTasks } from './cron-manager'

// Initialize Sentry before any error handlers
Sentry.init({
  dsn: process.env.SENTRY_DSN || '',
  environment: app.isPackaged ? 'production' : 'development',
  sendDefaultPii: false,
  beforeSend(event) {
    // Filter out events containing apiKey to prevent credential leaks
    if (JSON.stringify(event).includes('apiKey')) return null
    return event
  },
})

// Prevent EPIPE errors from crashing the process when stdout/stderr pipes close
process.stdout?.on?.('error', (err: NodeJS.ErrnoException) => { if (err.code === 'EPIPE') process.stdout.destroy() })
process.stderr?.on?.('error', (err: NodeJS.ErrnoException) => { if (err.code === 'EPIPE') process.stderr.destroy() })

// Global error handlers to prevent silent crashes
process.on('unhandledRejection', (reason) => {
  console.error('[Main] Unhandled rejection:', reason)
  Sentry.captureException(reason instanceof Error ? reason : new Error(String(reason)))
  const window = getMainWindow()
  if (window && !window.isDestroyed()) {
    window.webContents.send('main:error', { type: 'unhandledRejection', message: String(reason) })
  }
})

process.on('uncaughtException', (error) => {
  console.error('[Main] Uncaught exception:', error)
  Sentry.captureException(error)
  const window = getMainWindow()
  if (window && !window.isDestroyed()) {
    window.webContents.send('main:error', { type: 'uncaughtException', message: error.message })
  }
})

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 680,
    minHeight: 400,
    show: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 8, y: 8 },
    transparent: true,
    backgroundColor: '#00000000',
    vibrancy: 'under-window',
    visualEffectState: 'active',
    title: 'Vision Agent',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    if (mainWindow) mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

app.whenReady().then(() => {
  setupMenu()
  registerIpcHandlers()
  initAppSkills()

  const savedTheme = getSettings().theme
  if (savedTheme !== 'system') {
    nativeTheme.themeSource = savedTheme
  }

  // Initialize file index for saved workspace
  const dirs = getAuthorizedDirectories()
  if (dirs.length > 0) {
    fileIndexService.init(dirs[0]).catch(() => {})
  }

  restorePersistedTasks()

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})