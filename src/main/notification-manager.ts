import { Notification, BrowserWindow, app } from 'electron'
import { getMainWindow } from './index'

const PERMISSION_NOTIFY_THRESHOLD_MS = 30_000

const pendingPermissionTimers = new Map<string, NodeJS.Timeout>()

function showNotification(title: string, body: string, onClick?: () => void, groupId?: string): void {
  if (!Notification.isSupported()) return

  // Skip notification when app is in foreground and window is visible
  if (process.platform === 'darwin' && app.isActive()) {
    const mainWindow = getMainWindow()
    if (mainWindow && !mainWindow.isMinimized()) return
  }

  const notification = new Notification({ title, body, groupId })
  if (onClick) {
    notification.on('click', () => {
      const window = getMainWindow()
      if (window) {
        if (window.isMinimized()) window.restore()
        window.focus()
      }
      onClick()
    })
  }
  notification.show()
}

export function notifyAgentComplete(sessionId: string): void {
  showNotification('Agent 任务完成', '点击返回查看结果', undefined, 'com.vision-agent.agent')
}

export function notifyCronTaskComplete(taskName: string, result: string): void {
  const preview = result.length > 100 ? result.substring(0, 100) + '...' : result
  showNotification(`定时任务完成: ${taskName}`, preview, undefined, 'com.vision-agent.cron')
}

export function schedulePermissionNotification(requestId: string, toolName: string): void {
  // If there's already a timer for this request, clear it
  const existing = pendingPermissionTimers.get(requestId)
  if (existing) clearTimeout(existing)

  const timer = setTimeout(() => {
    pendingPermissionTimers.delete(requestId)
    showNotification(
      'Agent 等待批准',
      `工具 "${toolName}" 需要你的许可才能继续`,
      () => {
        // Focus the permission dialog — just focus the window
        const window = getMainWindow()
        if (window) window.focus()
      },
      'com.vision-agent.permission'
    )
  }, PERMISSION_NOTIFY_THRESHOLD_MS)

  pendingPermissionTimers.set(requestId, timer)
}

export function cancelPermissionNotification(requestId: string): void {
  const timer = pendingPermissionTimers.get(requestId)
  if (timer) {
    clearTimeout(timer)
    pendingPermissionTimers.delete(requestId)
  }
}

export async function getNotificationHistory(): Promise<
  Array<{ id: string; groupId: string; title: string; body: string }>
> {
  if (process.platform !== 'darwin') return []
  try {
    const history = await Notification.getHistory()
    return history.map((n) => ({
      id: n.id,
      groupId: n.groupId ?? '',
      title: n.title,
      body: n.body
    }))
  } catch {
    return []
  }
}
