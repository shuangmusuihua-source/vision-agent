import { describe, expect, it } from 'vitest'
import { formatUpdateBytes, getUpdateProgressLabel } from '../src/renderer/lib/app-update'
import { toUpdateErrorPayload } from '../src/shared/update-types'

describe('application update UI formatting', () => {
  it('formats transferred bytes for compact progress labels', () => {
    expect(formatUpdateBytes(0)).toBe('0 MB')
    expect(formatUpdateBytes(1.5 * 1024 * 1024)).toBe('1.5 MB')
    expect(formatUpdateBytes(240.4 * 1024 * 1024)).toBe('240 MB')
  })

  it('shows percentage and downloaded size while downloading', () => {
    expect(getUpdateProgressLabel({
      status: 'downloading',
      version: '1.5.0',
      progress: {
        percent: 42.4,
        transferred: 101.5 * 1024 * 1024,
        total: 240 * 1024 * 1024,
        bytesPerSecond: 5 * 1024 * 1024,
      },
    })).toBe('102 MB / 240 MB · 42%')
  })

  it('returns no progress label outside the downloading state', () => {
    expect(getUpdateProgressLabel({ status: 'downloaded', version: '1.5.0' })).toBe('')
  })

  it('turns macOS signature failures into a manual download recovery', () => {
    expect(toUpdateErrorPayload(new Error('Code signature at URL file:///tmp/update.zip did not pass validation'))).toEqual({
      code: 'signature-invalid',
      message: '当前版本无法自动安装更新，请下载最新安装包后手动安装。',
    })
  })
})
