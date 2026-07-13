import { app, BrowserWindow, ipcMain, shell, nativeTheme } from 'electron'
import { join } from 'path'
import { configureAppIdentity } from './app-identity'
configureAppIdentity()
import { is } from '@electron-toolkit/utils'
import * as Sentry from '@sentry/electron/main'
import { autoUpdater } from 'electron-updater'
import { registerIpcHandlers } from './ipc-handlers'
import { setupMenu } from './menu'
import { getSettings } from './persistence/profile-store'
import { getAuthorizedDirectories, ensureKnowledgeBase } from './persistence/workspace-store'
import { fileIndexService } from './file-index-service'
import { initAppSkills } from './skill-init'
import { restorePersistedTasks } from './cron-manager'
import { setGenerationWindow, handleWindowDestroy, abortActiveQuery } from './query-runner'
import { inlineRewriteRunner } from './inline-rewrite-runner'
import { stopAllCronJobs } from './cron-manager'
import { setMainWindow, getMainWindow } from './ipc-sender'
import { flushAuditLog } from './agent-audit'
import { APP_NAME, GITHUB_LATEST_RELEASE_URL } from '../shared/branding'
import { toUpdateErrorPayload, type UpdateDownloadProgress } from '../shared/update-types'

// Initialize Sentry before any error handlers
Sentry.init({
  dsn: process.env.SENTRY_DSN || '',
  environment: app.isPackaged ? 'production' : 'development',
  sendDefaultPii: false,
  beforeSend(event) {
    // Recursively scan string values for 'apiKey' to prevent credential leaks.
    // Avoids JSON.stringify on every event — field-level traversal with early exit.
    const containsApiKey = (obj: unknown): boolean => {
      if (typeof obj === 'string') return obj.includes('apiKey')
      if (Array.isArray(obj)) return obj.some(containsApiKey)
      if (obj && typeof obj === 'object') return Object.values(obj as Record<string, unknown>).some(containsApiKey)
      return false
    }
    if (containsApiKey(event)) return null
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
let silentUpdateChecks = 0
let lastSilentUpdateCheckAt = 0

const FOREGROUND_UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000

type UpdateCheckResponse =
  | { status: 'available'; version?: string }
  | { status: 'not-available'; version?: string }
  | { status: 'skipped'; message: string }
  | { status: 'error'; message: string }

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isMissingUpdateFeedError(error: unknown): boolean {
  const message = getErrorMessage(error)
  return message.includes('404') && message.includes('releases.atom')
}

function sendUpdateError(error: unknown): void {
  const win = getMainWindow()
  if (win && !win.isDestroyed()) {
    win.webContents.send('update:error', toUpdateErrorPayload(error))
  }
}

async function checkForUpdates(options: { silentMissingFeed?: boolean } = {}): Promise<UpdateCheckResponse> {
  if (!app.isPackaged) return { status: 'skipped', message: '开发模式不检查更新' }

  if (options.silentMissingFeed) silentUpdateChecks += 1
  try {
    const result = await autoUpdater.checkForUpdates()
    if (!result) {
      return { status: 'skipped', message: '检查已在进行中' }
    }
    const version = result.updateInfo?.version
    return result.isUpdateAvailable
      ? { status: 'available', version }
      : { status: 'not-available', version }
  } catch (error) {
    if (options.silentMissingFeed && isMissingUpdateFeedError(error)) {
      console.warn('[AutoUpdater] update feed unavailable; skipping launch check')
      return { status: 'skipped', message: '更新源暂不可用' }
    }
    throw error
  } finally {
    if (options.silentMissingFeed) {
      setTimeout(() => {
        silentUpdateChecks = Math.max(0, silentUpdateChecks - 1)
      }, 1000)
    }
  }
}

function checkForUpdatesSilently(reason: 'launch' | 'foreground'): void {
  if (!app.isPackaged) return

  const now = Date.now()
  if (reason === 'foreground' && now - lastSilentUpdateCheckAt < FOREGROUND_UPDATE_CHECK_INTERVAL_MS) return
  lastSilentUpdateCheckAt = now

  checkForUpdates({ silentMissingFeed: true }).catch((err) => {
    console.error(`[AutoUpdater] ${reason} check failed:`, err)
    Sentry.captureException(err)
  })
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 680,
    minHeight: 400,
    show: false,
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 8, y: 8 },
    transparent: true,
    backgroundColor: '#00000000',
    vibrancy: 'sidebar',
    visualEffectState: 'active',
    title: APP_NAME,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    }
  })

  // Register the window in ipc-sender so other modules can reach it
  setMainWindow(mainWindow)

  mainWindow.on('ready-to-show', () => {
    if (mainWindow) mainWindow.show()
  })

  mainWindow.on('closed', () => {
    inlineRewriteRunner.cancelAll()
    handleWindowDestroy()
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

// getMainWindow is now provided by ipc-sender module (re-exported below)
export { getMainWindow }

app.whenReady().then(async () => {
  setupMenu()

  // Set Dock icon in dev mode (production uses the bundled .icns)
  if (process.platform === 'darwin' && !app.isPackaged) {
    const iconPath = join(__dirname, '../../build/icon.png')
    app.dock?.setIcon(iconPath)
  }

  // Ensure knowledge base directory exists and is registered
  const knowledgeDir = ensureKnowledgeBase()

  registerIpcHandlers()
  try {
    const skillInstall = await initAppSkills()
    if (skillInstall.installed.length > 0 || skillInstall.removed.length > 0) {
      console.info('[SkillInit] synchronized built-in skills', skillInstall)
    }
  } catch (error) {
    console.error('[SkillInit] failed to initialize built-in skills:', error)
    Sentry.captureException(error instanceof Error ? error : new Error(String(error)))
  }

  const savedTheme = getSettings().theme
  if (savedTheme !== 'system') {
    nativeTheme.themeSource = savedTheme
  }

  // Initialize one search index across all saved workspaces.
  const dirs = getAuthorizedDirectories()
  fileIndexService.init(dirs).catch((err) => {
    console.error('[Init] fileIndexService failed:', err)
    Sentry.captureException(err instanceof Error ? err : new Error(String(err)))
  })

  // Initialize knowledge base file index for semantic graph
  fileIndexService.initKnowledgeIndex(knowledgeDir).catch((err) => {
    console.error('[Init] knowledgeIndex init failed:', err)
    Sentry.captureException(err instanceof Error ? err : new Error(String(err)))
  })

  restorePersistedTasks()

  createWindow()

  const win = getMainWindow()
  if (win) setGenerationWindow(win)

  // Auto-updater: check for updates after launch (production only)
  if (app.isPackaged) {
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = true

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

    autoUpdater.on('download-progress', (progress) => {
      const win = getMainWindow()
      if (win && !win.isDestroyed()) {
        const payload: UpdateDownloadProgress = {
          percent: Math.max(0, Math.min(100, progress.percent)),
          transferred: progress.transferred,
          total: progress.total,
          bytesPerSecond: progress.bytesPerSecond,
        }
        win.webContents.send('update:download-progress', payload)
      }
    })

    autoUpdater.on('error', (err) => {
      if (silentUpdateChecks > 0 && isMissingUpdateFeedError(err)) {
        console.warn('[AutoUpdater] update feed unavailable; skipping launch check')
        return
      }
      console.error('[AutoUpdater] error:', err)
      Sentry.captureException(err)
      sendUpdateError(err)
    })

    checkForUpdatesSilently('launch')
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
    checkForUpdatesSilently('foreground')
  })

  app.on('browser-window-focus', () => {
    checkForUpdatesSilently('foreground')
  })
})

// IPC: update actions from renderer
ipcMain.handle('update:download', async () => {
  await autoUpdater.downloadUpdate()
})
ipcMain.handle('update:install', () => autoUpdater.quitAndInstall())
ipcMain.handle('update:openLatestRelease', () => shell.openExternal(GITHUB_LATEST_RELEASE_URL))
ipcMain.handle('update:checkForUpdates', async () => {
  try {
    return await checkForUpdates()
  } catch (error) {
    const message = getErrorMessage(error)
    sendUpdateError(error)
    console.error('[AutoUpdater] manual check failed:', error)
    return { status: 'error', message }
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', async () => {
  abortActiveQuery()
  inlineRewriteRunner.cancelAll()
  handleWindowDestroy()
  stopAllCronJobs()
  await flushAuditLog()
})
