import { useUiStore, type AppUpdateState } from '../store/ui-slice'

function setUpdateState(state: AppUpdateState): void {
  useUiStore.getState().setUpdateState(state)
}

function getUpdateState(): AppUpdateState {
  return useUiStore.getState().updateState
}

export function subscribeToAppUpdates(): () => void {
  const offAvailable = window.api.update.onAvailable((info) => {
    setUpdateState({ status: 'available', version: info.version })
  })
  const offProgress = window.api.update.onDownloadProgress((progress) => {
    const current = getUpdateState()
    setUpdateState({
      status: 'downloading',
      version: current.version,
      progress,
    })
  })
  const offDownloaded = window.api.update.onDownloaded(() => {
    const current = getUpdateState()
    setUpdateState({ status: 'downloaded', version: current.version })
  })
  const offError = window.api.update.onError((error) => {
    const current = getUpdateState()
    setUpdateState({
      status: 'error',
      version: current.version,
      message: error.message,
      recovery: error.code === 'signature-invalid' ? 'manual-download' : undefined,
    })
  })

  return () => {
    offAvailable()
    offProgress()
    offDownloaded()
    offError()
  }
}

export async function checkForAppUpdates(): Promise<void> {
  setUpdateState({ status: 'checking' })
  try {
    const result = await window.api.update.checkForUpdates()
    if (result.status === 'available') {
      setUpdateState({ status: 'available', version: result.version })
    } else if (result.status === 'not-available') {
      setUpdateState({ status: 'latest', version: result.version })
    } else if (result.status === 'skipped') {
      setUpdateState({ status: 'skipped', message: result.message })
    } else {
      setUpdateState({ status: 'error', message: result.message })
    }
  } catch (error) {
    setUpdateState({ status: 'error', message: error instanceof Error ? error.message : String(error) })
  }
}

export async function downloadAppUpdate(): Promise<void> {
  const current = getUpdateState()
  if (current.status !== 'available' && !(current.status === 'error' && current.version)) return

  setUpdateState({
    status: 'downloading',
    version: current.version,
    progress: { percent: 0, transferred: 0, total: 0, bytesPerSecond: 0 },
  })
  try {
    await window.api.update.download()
    const latest = getUpdateState()
    if (latest.status === 'downloading') {
      setUpdateState({ status: 'downloaded', version: latest.version })
    }
  } catch (error) {
    setUpdateState({
      status: 'error',
      version: current.version,
      message: error instanceof Error ? error.message : String(error),
    })
  }
}

export async function installAppUpdate(): Promise<void> {
  const current = getUpdateState()
  if (current.status !== 'downloaded') return

  setUpdateState({ status: 'installing', version: current.version })
  try {
    await window.api.update.install()
  } catch (error) {
    setUpdateState({
      status: 'error',
      version: current.version,
      message: error instanceof Error ? error.message : String(error),
    })
  }
}

export async function performPrimaryUpdateAction(): Promise<void> {
  const current = getUpdateState()
  if (current.status === 'error' && current.recovery === 'manual-download') {
    await window.api.update.openLatestRelease()
  } else if (current.status === 'downloaded') {
    await installAppUpdate()
  } else if (current.status === 'available' || (current.status === 'error' && current.version)) {
    await downloadAppUpdate()
  } else if (!['checking', 'downloading', 'installing'].includes(current.status)) {
    await checkForAppUpdates()
  }
}

export function formatUpdateBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB'
  const megabytes = bytes / (1024 * 1024)
  if (megabytes < 10) return `${megabytes.toFixed(1)} MB`
  return `${Math.round(megabytes)} MB`
}

export function getUpdateProgressLabel(state: AppUpdateState): string {
  if (state.status !== 'downloading' || !state.progress) return ''
  const percent = Math.round(state.progress.percent)
  if (state.progress.total <= 0) return `正在下载 ${percent}%`
  return `${formatUpdateBytes(state.progress.transferred)} / ${formatUpdateBytes(state.progress.total)} · ${percent}%`
}
