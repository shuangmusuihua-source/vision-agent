import { app, ipcMain, shell } from 'electron'
import * as Sentry from '@sentry/electron/main'
import { autoUpdater } from 'electron-updater'
import { GITHUB_LATEST_RELEASE_URL } from '../shared/branding'
import {
  toUpdateErrorPayload,
  type UpdateCheckResult,
  type UpdateDownloadProgress,
} from '../shared/update-types'
import { getMainWindow } from './ipc-sender'

const FOREGROUND_UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000

type UpdateInfo = {
  version?: string
}

type UpdateCheck = {
  isUpdateAvailable: boolean
  updateInfo?: UpdateInfo
}

type UpdateProgress = {
  percent: number
  transferred: number
  total: number
  bytesPerSecond: number
}

export interface AppUpdaterAdapter {
  configure(): void
  checkForUpdates(): Promise<UpdateCheck | null>
  downloadUpdate(): Promise<unknown>
  quitAndInstall(): void
  onUpdateAvailable(listener: (info: UpdateInfo) => void): void
  onUpdateDownloaded(listener: () => void): void
  onDownloadProgress(listener: (progress: UpdateProgress) => void): void
  onError(listener: (error: Error) => void): void
}

export interface UpdateIpcAdapter {
  onDownload(listener: () => unknown): void
  onInstall(listener: () => unknown): void
  onOpenLatestRelease(listener: () => unknown): void
  onCheckForUpdates(listener: () => unknown): void
}

export interface UpdateRendererAdapter {
  send(channel: string, payload?: unknown): void
}

export interface AppUpdateLifecycleOptions {
  isPackaged: () => boolean
  updater: AppUpdaterAdapter
  ipc: UpdateIpcAdapter
  renderer: UpdateRendererAdapter
  openLatestRelease: () => Promise<unknown>
  captureException: (error: Error) => void
  now?: () => number
  schedule?: (callback: () => void, delayMs: number) => unknown
  foregroundCheckIntervalMs?: number
  logger?: Pick<Console, 'error' | 'warn'>
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isMissingUpdateFeedError(error: unknown): boolean {
  const message = getErrorMessage(error)
  return message.includes('404') && message.includes('releases.atom')
}

export class AppUpdateLifecycle {
  private readonly now: () => number
  private readonly schedule: (callback: () => void, delayMs: number) => unknown
  private readonly foregroundCheckIntervalMs: number
  private readonly logger: Pick<Console, 'error' | 'warn'>
  private started = false
  private silentUpdateChecks = 0
  private lastSilentUpdateCheckAt = 0

  constructor(private readonly options: AppUpdateLifecycleOptions) {
    this.now = options.now ?? Date.now
    this.schedule = options.schedule ?? setTimeout
    this.foregroundCheckIntervalMs =
      options.foregroundCheckIntervalMs ?? FOREGROUND_UPDATE_CHECK_INTERVAL_MS
    this.logger = options.logger ?? console
  }

  start(): void {
    if (this.started) return
    this.started = true
    this.registerIpc()
    if (!this.options.isPackaged()) return

    this.options.updater.configure()
    this.options.updater.onUpdateAvailable((info) => {
      this.options.renderer.send('update:available', { version: info.version || '' })
    })
    this.options.updater.onUpdateDownloaded(() => {
      this.options.renderer.send('update:downloaded')
    })
    this.options.updater.onDownloadProgress((progress) => {
      const payload: UpdateDownloadProgress = {
        percent: Math.max(0, Math.min(100, progress.percent)),
        transferred: progress.transferred,
        total: progress.total,
        bytesPerSecond: progress.bytesPerSecond,
      }
      this.options.renderer.send('update:download-progress', payload)
    })
    this.options.updater.onError((error) => {
      if (this.silentUpdateChecks > 0 && isMissingUpdateFeedError(error)) {
        this.logger.warn('[AutoUpdater] update feed unavailable; skipping launch check')
        return
      }
      this.logger.error('[AutoUpdater] error:', error)
      this.options.captureException(error)
      this.sendUpdateError(error)
    })

    this.checkSilently('launch')
  }

  checkOnForeground(): void {
    this.checkSilently('foreground')
  }

  private registerIpc(): void {
    this.options.ipc.onDownload(async () => {
      await this.options.updater.downloadUpdate()
    })
    this.options.ipc.onInstall(() => {
      this.options.updater.quitAndInstall()
    })
    this.options.ipc.onOpenLatestRelease(() => {
      return this.options.openLatestRelease()
    })
    this.options.ipc.onCheckForUpdates(async () => {
      try {
        return await this.checkForUpdates()
      } catch (error) {
        const message = getErrorMessage(error)
        this.sendUpdateError(error)
        this.logger.error('[AutoUpdater] manual check failed:', error)
        return { status: 'error', message } satisfies UpdateCheckResult
      }
    })
  }

  private async checkForUpdates(options: { silentMissingFeed?: boolean } = {}): Promise<UpdateCheckResult> {
    if (!this.options.isPackaged()) {
      return { status: 'skipped', message: '开发模式不检查更新' }
    }

    if (options.silentMissingFeed) this.silentUpdateChecks += 1
    try {
      const result = await this.options.updater.checkForUpdates()
      if (!result) {
        return { status: 'skipped', message: '检查已在进行中' }
      }
      const version = result.updateInfo?.version
      return result.isUpdateAvailable
        ? { status: 'available', version }
        : { status: 'not-available', version }
    } catch (error) {
      if (options.silentMissingFeed && isMissingUpdateFeedError(error)) {
        this.logger.warn('[AutoUpdater] update feed unavailable; skipping launch check')
        return { status: 'skipped', message: '更新源暂不可用' }
      }
      throw error
    } finally {
      if (options.silentMissingFeed) {
        this.schedule(() => {
          this.silentUpdateChecks = Math.max(0, this.silentUpdateChecks - 1)
        }, 1000)
      }
    }
  }

  private checkSilently(reason: 'launch' | 'foreground'): void {
    if (!this.options.isPackaged()) return

    const now = this.now()
    if (
      reason === 'foreground'
      && now - this.lastSilentUpdateCheckAt < this.foregroundCheckIntervalMs
    ) {
      return
    }
    this.lastSilentUpdateCheckAt = now

    void this.checkForUpdates({ silentMissingFeed: true }).catch((error) => {
      const normalized = error instanceof Error ? error : new Error(String(error))
      this.logger.error(`[AutoUpdater] ${reason} check failed:`, normalized)
      this.options.captureException(normalized)
    })
  }

  private sendUpdateError(error: unknown): void {
    this.options.renderer.send('update:error', toUpdateErrorPayload(error))
  }
}

const electronUpdaterAdapter: AppUpdaterAdapter = {
  configure() {
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = true
  },
  checkForUpdates: () => autoUpdater.checkForUpdates(),
  downloadUpdate: () => autoUpdater.downloadUpdate(),
  quitAndInstall: () => autoUpdater.quitAndInstall(),
  onUpdateAvailable: (listener) => {
    autoUpdater.on('update-available', listener)
  },
  onUpdateDownloaded: (listener) => {
    autoUpdater.on('update-downloaded', listener)
  },
  onDownloadProgress: (listener) => {
    autoUpdater.on('download-progress', listener)
  },
  onError: (listener) => {
    autoUpdater.on('error', listener)
  },
}

export const appUpdateLifecycle = new AppUpdateLifecycle({
  isPackaged: () => app.isPackaged,
  updater: electronUpdaterAdapter,
  ipc: {
    onDownload: (listener) => {
      ipcMain.handle('update:download', listener)
    },
    onInstall: (listener) => {
      ipcMain.handle('update:install', listener)
    },
    onOpenLatestRelease: (listener) => {
      ipcMain.handle('update:openLatestRelease', listener)
    },
    onCheckForUpdates: (listener) => {
      ipcMain.handle('update:checkForUpdates', listener)
    },
  },
  renderer: {
    send(channel, payload) {
      const window = getMainWindow()
      if (!window) return
      window.webContents.send(channel, payload)
    },
  },
  openLatestRelease: () => shell.openExternal(GITHUB_LATEST_RELEASE_URL),
  captureException: (error) => {
    Sentry.captureException(error)
  },
})
