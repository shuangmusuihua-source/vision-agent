export interface UpdateDownloadProgress {
  percent: number
  transferred: number
  total: number
  bytesPerSecond: number
}

export type UpdateErrorCode = 'signature-invalid' | 'generic'

export interface UpdateErrorPayload {
  code: UpdateErrorCode
  message: string
}

export type UpdateCheckResult =
  | { status: 'available'; version?: string }
  | { status: 'not-available'; version?: string }
  | { status: 'skipped'; message: string }
  | { status: 'error'; message: string }

const SIGNATURE_ERROR_PATTERNS = [
  'code signature at url',
  'code signature did not pass validation',
  'code object is not signed',
  'err_updater_invalid_signature',
]

export function toUpdateErrorPayload(error: unknown): UpdateErrorPayload {
  const rawMessage = error instanceof Error ? error.message : String(error)
  const normalized = rawMessage.toLowerCase()
  if (SIGNATURE_ERROR_PATTERNS.some((pattern) => normalized.includes(pattern))) {
    return {
      code: 'signature-invalid',
      message: '当前版本无法自动安装更新，请下载最新安装包后手动安装。',
    }
  }
  return { code: 'generic', message: rawMessage }
}
