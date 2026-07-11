import type { AgentNotificationEvent } from '../../shared/types'

const MAX_NOTIFICATIONS = 30
const TOAST_DISMISS_MS = 5_200
const STORAGE_KEY = 'sumi.inAppNotifications.v1'

export type AppNotification = AgentNotificationEvent & {
  id: string
  receivedAt: number
  read: boolean
}

export type NotificationInboxSnapshot = {
  notifications: AppNotification[]
  unreadNotifications: AppNotification[]
  unreadCount: number
  toast: AppNotification | null
  listOpen: boolean
  selected: AppNotification | null
}

export type NotificationStorageAdapter = {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
}

export type NotificationTimerAdapter = {
  set: (callback: () => void, delayMs: number) => unknown
  clear: (handle: unknown) => void
}

type NotificationInboxOptions = {
  now?: () => number
  createId?: () => string
  toastDismissMs?: number
}

function isStoredNotification(value: unknown): value is AppNotification {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  return typeof item.id === 'string' &&
    typeof item.title === 'string' &&
    typeof item.message === 'string' &&
    typeof item.receivedAt === 'number' &&
    typeof item.read === 'boolean'
}

export function notificationTimeLabel(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function notificationDateTimeLabel(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function getNotificationTargetLabel(notification: AppNotification): string | null {
  const target = notification.target
  if (target?.view === 'automation') return '自动化'
  if (target?.view === 'skills') return '技能'
  if (target?.view === 'ask') return 'Ask sumi'
  if (target?.view === 'editor') return '工作区会话'
  if ('context' in notification && notification.context === 'ask') return 'Ask sumi'
  if ('context' in notification && notification.context === 'editor') return '工作区会话'
  return null
}

export class NotificationInbox {
  private notifications: AppNotification[]
  private toast: AppNotification | null = null
  private listOpen = false
  private selectedId: string | null = null
  private toastTimer: unknown = null
  private listeners = new Set<() => void>()
  private snapshot: NotificationInboxSnapshot
  private readonly now: () => number
  private readonly createId: () => string
  private readonly toastDismissMs: number

  constructor(
    private readonly storage: NotificationStorageAdapter,
    private readonly timers: NotificationTimerAdapter,
    options: NotificationInboxOptions = {},
  ) {
    this.now = options.now || Date.now
    this.createId = options.createId || (() => `${this.now()}-${Math.random().toString(36).slice(2, 8)}`)
    this.toastDismissMs = options.toastDismissMs ?? TOAST_DISMISS_MS
    this.notifications = this.load()
    this.snapshot = this.buildSnapshot()
  }

  getSnapshot = (): NotificationInboxSnapshot => this.snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  receive(notification: AgentNotificationEvent): void {
    this.clearToastTimer()
    const next: AppNotification = {
      ...notification,
      id: this.createId(),
      receivedAt: this.now(),
      read: false,
    }
    this.notifications = [next, ...this.notifications].slice(0, MAX_NOTIFICATIONS)
    this.toast = next
    this.persist()
    this.publish()
    this.toastTimer = this.timers.set(() => {
      if (this.toast?.id === next.id) {
        this.toast = null
        this.publish()
      }
      this.toastTimer = null
    }, this.toastDismissMs)
  }

  open(notificationId: string): AppNotification | null {
    const notification = this.notifications.find((item) => item.id === notificationId) || null
    if (!notification) return null
    this.markRead(notificationId)
    this.clearToast(notificationId)
    this.listOpen = false
    this.selectedId = null
    this.publish()
    return notification
  }

  dismissToast(): void {
    const notificationId = this.toast?.id
    this.clearToast(notificationId)
    if (notificationId) this.markRead(notificationId)
    this.publish()
  }

  toggleList(): void {
    this.listOpen = !this.listOpen
    if (this.listOpen) this.selectedId = null
    this.publish()
  }

  select(notificationId: string): void {
    if (!this.notifications.some((item) => item.id === notificationId)) return
    this.clearToast(notificationId)
    this.markRead(notificationId)
    this.selectedId = notificationId
    this.publish()
  }

  clearSelection(): void {
    if (!this.selectedId) return
    this.selectedId = null
    this.publish()
  }

  markAllRead(): void {
    this.notifications = this.notifications.map((notification) => ({ ...notification, read: true }))
    this.selectedId = null
    this.listOpen = false
    this.persist()
    this.publish()
  }

  destroy(): void {
    this.clearToastTimer()
    this.listeners.clear()
  }

  private markRead(notificationId: string): void {
    let changed = false
    this.notifications = this.notifications.map((notification) => {
      if (notification.id !== notificationId || notification.read) return notification
      changed = true
      return { ...notification, read: true }
    })
    if (changed) this.persist()
  }

  private clearToast(notificationId?: string): void {
    this.clearToastTimer()
    if (!notificationId || this.toast?.id === notificationId) this.toast = null
  }

  private clearToastTimer(): void {
    if (this.toastTimer === null) return
    this.timers.clear(this.toastTimer)
    this.toastTimer = null
  }

  private load(): AppNotification[] {
    try {
      const raw = this.storage.getItem(STORAGE_KEY)
      if (!raw) return []
      const parsed: unknown = JSON.parse(raw)
      return Array.isArray(parsed)
        ? parsed.filter(isStoredNotification).slice(0, MAX_NOTIFICATIONS)
        : []
    } catch {
      return []
    }
  }

  private persist(): void {
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(this.notifications.slice(0, MAX_NOTIFICATIONS)))
    } catch {
      // Notification history is helpful but non-critical.
    }
  }

  private buildSnapshot(): NotificationInboxSnapshot {
    const unreadNotifications = this.notifications.filter((notification) => !notification.read)
    return {
      notifications: this.notifications,
      unreadNotifications,
      unreadCount: unreadNotifications.length,
      toast: this.toast,
      listOpen: this.listOpen,
      selected: this.selectedId
        ? this.notifications.find((notification) => notification.id === this.selectedId) || null
        : null,
    }
  }

  private publish(): void {
    this.snapshot = this.buildSnapshot()
    for (const listener of this.listeners) listener()
  }
}
