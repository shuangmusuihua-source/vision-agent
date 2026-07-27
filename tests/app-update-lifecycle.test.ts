import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { isPackaged: false },
  ipcMain: { handle: vi.fn() },
  shell: { openExternal: vi.fn() },
}))

vi.mock('@sentry/electron/main', () => ({
  captureException: vi.fn(),
}))

vi.mock('electron-updater', () => ({
  autoUpdater: {
    autoDownload: true,
    autoInstallOnAppQuit: false,
    checkForUpdates: vi.fn(),
    downloadUpdate: vi.fn(),
    quitAndInstall: vi.fn(),
    on: vi.fn(),
  },
}))

import {
  AppUpdateLifecycle,
  type AppUpdaterAdapter,
  type UpdateIpcAdapter,
  type UpdateRendererAdapter,
} from '../src/main/app-update-lifecycle'

type UpdateHandler = () => unknown

class FakeUpdater implements AppUpdaterAdapter {
  configureCalls = 0
  checkCalls = 0
  downloadCalls = 0
  installCalls = 0
  checkResult: Awaited<ReturnType<AppUpdaterAdapter['checkForUpdates']>> = {
    isUpdateAvailable: false,
    updateInfo: { version: '1.7.0' },
  }
  checkError: Error | null = null
  availableListener: ((info: { version?: string }) => void) | null = null
  downloadedListener: (() => void) | null = null
  progressListener: ((progress: {
    percent: number
    transferred: number
    total: number
    bytesPerSecond: number
  }) => void) | null = null
  errorListener: ((error: Error) => void) | null = null

  configure(): void {
    this.configureCalls += 1
  }

  async checkForUpdates() {
    this.checkCalls += 1
    if (this.checkError) {
      this.errorListener?.(this.checkError)
      throw this.checkError
    }
    return this.checkResult
  }

  async downloadUpdate(): Promise<void> {
    this.downloadCalls += 1
  }

  quitAndInstall(): void {
    this.installCalls += 1
  }

  onUpdateAvailable(listener: (info: { version?: string }) => void): void {
    this.availableListener = listener
  }

  onUpdateDownloaded(listener: () => void): void {
    this.downloadedListener = listener
  }

  onDownloadProgress(listener: (progress: {
    percent: number
    transferred: number
    total: number
    bytesPerSecond: number
  }) => void): void {
    this.progressListener = listener
  }

  onError(listener: (error: Error) => void): void {
    this.errorListener = listener
  }
}

function createHarness(options: {
  packaged?: boolean
  now?: () => number
  updater?: FakeUpdater
} = {}) {
  const updater = options.updater ?? new FakeUpdater()
  const handlers = new Map<string, UpdateHandler>()
  const ipc: UpdateIpcAdapter = {
    onDownload: (listener) => handlers.set('update:download', listener),
    onInstall: (listener) => handlers.set('update:install', listener),
    onOpenLatestRelease: (listener) => handlers.set('update:openLatestRelease', listener),
    onCheckForUpdates: (listener) => handlers.set('update:checkForUpdates', listener),
  }
  const events: Array<{ channel: string; payload?: unknown }> = []
  const renderer: UpdateRendererAdapter = {
    send(channel, payload) {
      events.push({ channel, payload })
    },
  }
  const captured: Error[] = []
  const scheduled: Array<() => void> = []
  const openLatestRelease = vi.fn(async () => undefined)
  const lifecycle = new AppUpdateLifecycle({
    isPackaged: () => options.packaged ?? true,
    updater,
    ipc,
    renderer,
    openLatestRelease,
    captureException: (error) => captured.push(error),
    now: options.now,
    schedule: (callback) => {
      scheduled.push(callback)
    },
    logger: { error: vi.fn(), warn: vi.fn() },
  })
  return {
    lifecycle,
    updater,
    handlers,
    events,
    captured,
    scheduled,
    openLatestRelease,
  }
}

describe('AppUpdateLifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('registers one IPC interface in development without activating the updater', async () => {
    const harness = createHarness({ packaged: false })

    harness.lifecycle.start()
    harness.lifecycle.start()

    expect(harness.handlers.size).toBe(4)
    expect(harness.updater.configureCalls).toBe(0)
    expect(await harness.handlers.get('update:checkForUpdates')?.()).toEqual({
      status: 'skipped',
      message: '开发模式不检查更新',
    })

    await harness.handlers.get('update:download')?.()
    harness.handlers.get('update:install')?.()
    await harness.handlers.get('update:openLatestRelease')?.()
    expect(harness.updater.downloadCalls).toBe(1)
    expect(harness.updater.installCalls).toBe(1)
    expect(harness.openLatestRelease).toHaveBeenCalledOnce()
  })

  it('projects updater events and clamps progress through the renderer adapter', () => {
    const harness = createHarness()

    harness.lifecycle.start()
    harness.updater.availableListener?.({ version: '1.8.0' })
    harness.updater.downloadedListener?.()
    harness.updater.progressListener?.({
      percent: 140,
      transferred: 80,
      total: 100,
      bytesPerSecond: 20,
    })

    expect(harness.updater.configureCalls).toBe(1)
    expect(harness.events).toEqual([
      { channel: 'update:available', payload: { version: '1.8.0' } },
      { channel: 'update:downloaded', payload: undefined },
      {
        channel: 'update:download-progress',
        payload: {
          percent: 100,
          transferred: 80,
          total: 100,
          bytesPerSecond: 20,
        },
      },
    ])
  })

  it('throttles foreground checks while always performing the launch check', () => {
    let now = 1_000_000
    const harness = createHarness({ now: () => now })

    harness.lifecycle.start()
    harness.lifecycle.checkOnForeground()
    expect(harness.updater.checkCalls).toBe(1)

    now += 24 * 60 * 60 * 1000
    harness.lifecycle.checkOnForeground()
    expect(harness.updater.checkCalls).toBe(2)
  })

  it('suppresses a missing release feed during a silent check', async () => {
    const updater = new FakeUpdater()
    updater.checkError = new Error('404 releases.atom')
    const harness = createHarness({ updater })

    harness.lifecycle.start()
    await vi.waitFor(() => expect(harness.scheduled).toHaveLength(1))

    expect(harness.events).toEqual([])
    expect(harness.captured).toEqual([])
  })

  it('returns manual check failures and exposes a recoverable renderer error', async () => {
    const harness = createHarness()
    harness.lifecycle.start()
    harness.updater.checkError = new Error('network unavailable')

    expect(await harness.handlers.get('update:checkForUpdates')?.()).toEqual({
      status: 'error',
      message: 'network unavailable',
    })
    expect(harness.events).toContainEqual({
      channel: 'update:error',
      payload: { code: 'generic', message: 'network unavailable' },
    })
  })
})
