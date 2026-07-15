export const OFFICECLI_VERSION = '1.0.136'

export type OfficeCliRuntimeStatus =
  | {
      state: 'ready'
      version: string
      executablePath: string
    }
  | {
      state: 'not-installed'
      version: string
      downloadSizeBytes: number
      reason?: 'missing' | 'invalid'
    }
  | {
      state: 'unsupported'
      platform: string
      arch: string
    }

export type OfficeCliRuntimeInstallResult =
  | { success: true; status: Extract<OfficeCliRuntimeStatus, { state: 'ready' }> }
  | { success: false; error: string }
