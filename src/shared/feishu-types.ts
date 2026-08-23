export const FEISHU_CLI_VERSION = '1.0.89'
export const FEISHU_CALENDAR_READ_SCOPE = 'calendar:calendar.event:read'

export type FeishuRuntimeStatus =
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

export type FeishuRuntimeInstallResult =
  | { success: true; status: Extract<FeishuRuntimeStatus, { state: 'ready' }> }
  | { success: false; error: string }

export type FeishuConnectorPhase =
  | 'runtime-missing'
  | 'not-configured'
  | 'unauthorized'
  | 'bot-only'
  | 'configuring'
  | 'authorizing'
  | 'connected'
  | 'error'

export interface FeishuConnectorIdentity {
  displayName?: string
  openId?: string
  userAvailable: boolean
  botAvailable: boolean
  userScopes?: string[]
}

export interface FeishuConnectorStatus {
  phase: FeishuConnectorPhase
  runtime: FeishuRuntimeStatus
  identity?: FeishuConnectorIdentity
  error?: string
}

export interface FeishuConnectorActionResult {
  success: boolean
  error?: string
}

export interface FeishuAuthChallenge {
  operation: 'configure' | 'login' | 'grant-calendar'
  url: string
}
