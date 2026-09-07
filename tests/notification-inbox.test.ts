import { describe, expect, it, vi } from 'vitest'
import type { AgentNotificationEvent, SessionRoutedPermissionRequest } from '../src/shared/types'
import {
  NotificationInbox,
  type NotificationStorageAdapter,
  type NotificationTimerAdapter,
} from '../src/renderer/notifications/notification-inbox'

function notification(index: number): AgentNotificationEvent {
  return {
    type: index % 2 ? 'success' : 'info',
    title: `Notification ${index}`,
    message: `Message ${index}`,
    target: { view: 'automation', taskId: `task-${index}` },
  }
}

function setup(initial: unknown[] = []) {
  let stored = JSON.stringify(initial)
  const storage: NotificationStorageAdapter = {
    getItem: vi.fn(() => stored),
    setItem: vi.fn((_key, value) => { stored = value }),
  }
  let nextTimerId = 0
  const callbacks = new Map<number, () => void>()
  const timers: NotificationTimerAdapter = {
    set: vi.fn((callback) => {
      const id = ++nextTimerId
      callbacks.set(id, callback)
      return id
    }),
    clear: vi.fn((handle) => callbacks.delete(handle as number)),
  }
  let now = 100
  let id = 0
  const inbox = new NotificationInbox(storage, timers, {
    now: () => ++now,
    createId: () => `notification-${++id}`,
    toastDismissMs: 10,
  })
  return { inbox, storage, timers, callbacks, readStored: () => JSON.parse(stored) }
}

describe('NotificationInbox', () => {
  it('loads only valid stored notifications', () => {
    const valid = {
      ...notification(1),
      id: 'stored-1',
      receivedAt: 1,
      read: false,
    }
    const { inbox } = setup([valid, { title: 'broken' }, null])

    expect(inbox.getSnapshot().notifications).toEqual([valid])
  })

  it('owns retention, persistence, and toast replacement', () => {
    const { inbox, timers, callbacks, readStored } = setup()
    for (let index = 0; index < 31; index++) inbox.receive(notification(index))

    const snapshot = inbox.getSnapshot()
    expect(snapshot.notifications).toHaveLength(30)
    expect(snapshot.notifications[0].id).toBe('notification-31')
    expect(snapshot.notifications.some((item) => item.id === 'notification-1')).toBe(false)
    expect(snapshot.toast?.id).toBe('notification-31')
    expect(snapshot.unreadCount).toBe(30)
    expect(readStored()).toHaveLength(30)
    expect(timers.clear).toHaveBeenCalled()

    for (const callback of callbacks.values()) callback()
    expect(inbox.getSnapshot().toast).toBeNull()
  })

  it('owns detail, read, and list state transitions', () => {
    const { inbox } = setup()
    inbox.receive(notification(1))
    const id = inbox.getSnapshot().notifications[0].id

    inbox.toggleList()
    inbox.select(id)
    expect(inbox.getSnapshot()).toMatchObject({
      listOpen: true,
      unreadCount: 0,
      selected: { id },
      toast: null,
    })

    inbox.clearSelection()
    expect(inbox.getSnapshot().selected).toBeNull()
    inbox.toggleList()
    inbox.receive(notification(2))
    inbox.markAllRead()
    expect(inbox.getSnapshot()).toMatchObject({
      listOpen: false,
      unreadCount: 0,
      selected: null,
    })
  })

  it('opens a notification and returns its navigation payload', () => {
    const { inbox } = setup()
    inbox.receive(notification(7))
    const item = inbox.getSnapshot().notifications[0]
    inbox.toggleList()

    expect(inbox.open(item.id)?.target).toEqual({ view: 'automation', taskId: 'task-7' })
    expect(inbox.getSnapshot()).toMatchObject({
      listOpen: false,
      unreadCount: 0,
      selected: null,
      toast: null,
    })
  })

  it('remains usable when storage fails', () => {
    const storage: NotificationStorageAdapter = {
      getItem: () => { throw new Error('unavailable') },
      setItem: () => { throw new Error('unavailable') },
    }
    const timers: NotificationTimerAdapter = {
      set: () => 1,
      clear: () => {},
    }
    const inbox = new NotificationInbox(storage, timers)

    expect(() => inbox.receive(notification(1))).not.toThrow()
    expect(inbox.getSnapshot().notifications).toHaveLength(1)
  })
})

function permission(id: string, sessionId = 'session-a'): SessionRoutedPermissionRequest {
  return { id, sessionId, context: 'editor', workspacePath: '/workspace', toolName: 'Bash', input: {} }
}

describe('pending approval notifications', () => {
  it('removes legacy SDK permission history without deleting ordinary notifications', () => {
    const base = { id: 'old', receivedAt: 1, read: false, title: '', type: 'info' }
    const { inbox, readStored } = setup([
      { ...base, message: 'Claude needs your permission to use Bash' },
      { ...base, id: 'typed', type: 'permission_prompt', message: 'Approval needed' },
      { ...base, id: 'keep', message: 'Completed' },
    ])
    expect(inbox.getSnapshot().notifications.map((item) => item.id)).toEqual(['keep'])
    expect(readStored().map((item: { id: string }) => item.id)).toEqual(['keep'])
    inbox.receive({ type: 'permission_prompt', title: '', message: 'Approval needed' })
    expect(inbox.getSnapshot().notifications).toHaveLength(1)
  })

  it('deduplicates mirrored requests while preserving separate session ownership', () => {
    const { inbox, readStored } = setup()
    const a = permission('a')
    const b = permission('b', 'session-b')
    inbox.syncPermissions([a, a, b])
    expect(inbox.getSnapshot().unreadCount).toBe(2)
    const snapshot = inbox.getSnapshot()
    inbox.syncPermissions([a, b])
    expect(inbox.getSnapshot()).toBe(snapshot)
    expect(readStored()).toEqual([])
    expect(inbox.open('permission:b')).toMatchObject({ sessionId: 'session-b', workspacePath: '/workspace' })
    inbox.syncPermissions([a, b])
    expect(inbox.getSnapshot().unreadCount).toBe(1)
    expect(inbox.getSnapshot().notifications).toHaveLength(2)
  })

  it('removes completed requests and selected details, preserving unrelated history', () => {
    const { inbox } = setup()
    inbox.receive(notification(1))
    inbox.syncPermissions([permission('a'), permission('b')])
    inbox.select('permission:a')
    inbox.syncPermissions([permission('b')])
    expect(inbox.getSnapshot().selected).toBeNull()
    expect(inbox.getSnapshot().unreadCount).toBe(2)
    inbox.syncPermissions([])
    expect(inbox.getSnapshot().notifications).toHaveLength(1)
    expect(inbox.getSnapshot().toast?.id).toBe('notification-1')
  })

  it('marking read does not resolve or persist pending approvals', () => {
    const { inbox, readStored } = setup()
    inbox.syncPermissions([permission('a')])
    inbox.markAllRead()
    inbox.syncPermissions([permission('a')])
    expect(inbox.getSnapshot().notifications).toHaveLength(1)
    expect(inbox.getSnapshot().unreadCount).toBe(0)
    expect(readStored()).toEqual([])
    inbox.syncPermissions([])
    expect(inbox.getSnapshot().notifications).toEqual([])
  })
})
