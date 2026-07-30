import { app, BrowserWindow, shell, nativeTheme } from 'electron'
import { join } from 'path'
import { homedir } from 'os'
import { pathToFileURL } from 'url'
import { configureAppIdentity } from './app-identity'
configureAppIdentity()
import { is } from '@electron-toolkit/utils'
import * as Sentry from '@sentry/electron/main'
import { registerIpcHandlers } from './ipc-handlers'
import { setupMenu } from './menu'
import { getApiKey, getSettings } from './persistence/profile-store'
import { getAuthorizedDirectories, ensureKnowledgeBase } from './persistence/workspace-store'
import { fileIndexService } from './file-index-service'
import { initAppSkills } from './skill-init'
import { restorePersistedTasks } from './cron-manager'
import { setGenerationWindow, handleWindowDestroy, abortActiveQuery } from './query-runner'
import { inlineRewriteRunner } from './inline-rewrite-runner'
import { stopAllCronJobs } from './cron-manager'
import { setMainWindow, getMainWindow } from './ipc-sender'
import { APP_NAME } from '../shared/branding'
import { isAllowedExternalUrl, isAllowedRendererNavigation } from './navigation-policy'
import { sanitizeTelemetryEvent } from '../shared/telemetry-sanitizer'
import { appUpdateLifecycle } from './app-update-lifecycle'

// Initialize Sentry before any error handlers
Sentry.init({
  dsn: process.env.SENTRY_DSN || '',
  environment: app.isPackaged ? 'production' : 'development',
  sendDefaultPii: false,
  beforeSend(event) {
    try {
      return sanitizeTelemetryEvent(event, {
        secretValues: [getApiKey(), process.env.SENTRY_DSN],
        privatePathPrefixes: getAuthorizedDirectories(),
        homeDirectory: homedir(),
      })
    } catch {
      // Privacy wins over telemetry if settings or sanitization fail.
      return null
    }
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
  const rendererEntry = is.dev && process.env['ELECTRON_RENDERER_URL']
    ? process.env['ELECTRON_RENDERER_URL']
    : pathToFileURL(join(__dirname, '../renderer/index.html')).href
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 720,
    minHeight: 560,
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
  setGenerationWindow(mainWindow)

  mainWindow.on('ready-to-show', () => {
    if (mainWindow) mainWindow.show()
  })

  mainWindow.on('closed', () => {
    abortActiveQuery()
    inlineRewriteRunner.cancelAll()
    handleWindowDestroy()
    setMainWindow(null)
    mainWindow = null
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    if (isAllowedExternalUrl(details.url)) {
      void shell.openExternal(details.url)
    }
    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
    if (!isAllowedRendererNavigation(targetUrl, rendererEntry)) {
      event.preventDefault()
    }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(rendererEntry)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

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

  appUpdateLifecycle.start()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
    appUpdateLifecycle.checkOnForeground()
  })

  app.on('browser-window-focus', () => {
    appUpdateLifecycle.checkOnForeground()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  abortActiveQuery()
  inlineRewriteRunner.cancelAll()
  handleWindowDestroy()
  stopAllCronJobs()
})
