import { app, BrowserWindow, ipcMain, shell, nativeTheme } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import * as Sentry from '@sentry/electron/main'
import { autoUpdater } from 'electron-updater'
import { registerIpcHandlers } from './ipc-handlers'
import { setupMenu } from './menu'
import { getSettings, getAuthorizedDirectories, ensureKnowledgeBase, getKnowledgeBaseDir } from './store'
import { fileIndexService } from './file-index-service'
import { initAppSkills } from './skill-init'
import { restorePersistedTasks } from './cron-manager'
import { setSkillOutputWindow } from './agent-manager'

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

  // Set Dock icon in dev mode (production uses the bundled .icns)
  if (process.platform === 'darwin' && !app.isPackaged) {
    const iconPath = join(__dirname, '../../build/icon.png')
    app.dock.setIcon(iconPath)
  }

  // Ensure knowledge base directory exists and is registered
  const knowledgeDir = ensureKnowledgeBase()

  registerIpcHandlers()
  initAppSkills()

  const savedTheme = getSettings().theme
  if (savedTheme !== 'system') {
    nativeTheme.themeSource = savedTheme
  }

  // Initialize file index for saved workspace
  const dirs = getAuthorizedDirectories()
  if (dirs.length > 0) {
    fileIndexService.init(dirs[0]).catch((err) => {
      console.error('[Init] fileIndexService failed:', err)
      Sentry.captureException(err instanceof Error ? err : new Error(String(err)))
    })
  }

  // Initialize knowledge base file index for semantic graph
  fileIndexService.initKnowledgeIndex(knowledgeDir).catch((err) => {
    console.error('[Init] knowledgeIndex init failed:', err)
    Sentry.captureException(err instanceof Error ? err : new Error(String(err)))
  })

  restorePersistedTasks()

  createWindow()

  const win = getMainWindow()
  if (win) setSkillOutputWindow(win)

  // Auto-updater: check for updates after launch (production only)
  if (app.isPackaged) {
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.checkForUpdates()

    autoUpdater.on('update-available', (info) => {
      const win = getMainWindow()
      if (win && !win.isDestroyed()) {
        win.webContents.send('update:available', { version: info.version })
      }
    })

    autoUpdater.on('update-downloaded', () => {
      const win = getMainWindow()
      if (win && !win.isDestroyed()) {
        win.webContents.send('update:downloaded')
      }
    })
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// IPC: update actions from renderer
ipcMain.handle('update:download', () => autoUpdater.downloadUpdate())
ipcMain.handle('update:install', () => autoUpdater.quitAndInstall())

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})