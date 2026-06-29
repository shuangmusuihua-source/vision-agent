import { ipcMain } from 'electron'
import { getMarkitdownRuntimeManager } from '../markitdown-runtime'
import type { MarkitdownFormat } from '../../shared/markitdown-runtime'

function normalizeFormats(formats: unknown): MarkitdownFormat[] | undefined {
  if (!Array.isArray(formats)) return undefined
  return formats.filter((format): format is MarkitdownFormat => (
    format === 'pdf' || format === 'docx' || format === 'pptx' || format === 'xlsx'
  ))
}

export function registerAttachmentHandlers(): void {
  ipcMain.handle('attachments:runtimeStatus', async (_event, request?: { formats?: unknown }) => {
    return getMarkitdownRuntimeManager().getStatus(normalizeFormats(request?.formats))
  })

  ipcMain.handle('attachments:installRuntime', async () => {
    return getMarkitdownRuntimeManager().install()
  })
}

