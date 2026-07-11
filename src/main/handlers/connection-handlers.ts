import { ipcMain } from 'electron'
import { getApiKey, getBaseUrl } from '../persistence/profile-store'

export function registerConnectionHandlers(): void {
  ipcMain.handle('settings:testConnection', async (_event, options: { baseUrl: string; apiKey: string; model: string }) => {
    try {
      const apiKey = options.apiKey || getApiKey()
      if (!apiKey) return { success: false, message: '未找到有效的 API Key，请先在设置中配置' }
      const baseUrl = (options.baseUrl || getBaseUrl()).replace(/\/+$/, '')
      const response = await fetch(`${baseUrl}/v1/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: options.model, max_tokens: 16, messages: [{ role: 'user', content: 'Hi' }] }),
        signal: AbortSignal.timeout(15000),
      })
      if (response.ok) return { success: true, message: '连接成功' }
      const body = await response.text().catch(() => '')
      let errorMsg = `HTTP ${response.status}`
      try { errorMsg = JSON.parse(body).error?.message || JSON.parse(body).message || errorMsg } catch {}
      return { success: false, message: errorMsg }
    } catch (err) { return { success: false, message: (err as Error).message } }
  })
}
