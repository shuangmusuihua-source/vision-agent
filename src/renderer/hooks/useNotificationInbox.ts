import { useAgentStore } from '../store/agent-store-impl'
import { useEffect, useRef, useSyncExternalStore } from 'react'
import {
  NotificationInbox,
  type NotificationStorageAdapter,
  type NotificationTimerAdapter,
} from '../notifications/notification-inbox'

export function useNotificationInbox() {
  const inboxRef = useRef<NotificationInbox | null>(null)
  if (!inboxRef.current) {
    const storage: NotificationStorageAdapter = {
      getItem: (key) => window.localStorage.getItem(key),
      setItem: (key, value) => window.localStorage.setItem(key, value),
    }
    const timers: NotificationTimerAdapter = {
      set: (callback, delayMs) => window.setTimeout(callback, delayMs),
      clear: (handle) => window.clearTimeout(handle as number),
    }
    inboxRef.current = new NotificationInbox(storage, timers)
  }

  const inbox = inboxRef.current
  const snapshot = useSyncExternalStore(inbox.subscribe, inbox.getSnapshot, inbox.getSnapshot)

  useEffect(() => {
    const syncPermissions = () => {
      const state = useAgentStore.getState()
      inbox.syncPermissions([...Object.values(state.slots), ...Object.values(state.sessionSlots)]
        .flatMap((slot) => [...(slot.permissionRequest ? [slot.permissionRequest] : []), ...slot.permissionQueue]))
    }
    syncPermissions()
    const unsubscribeStore = useAgentStore.subscribe(syncPermissions)
    const unsubscribe = window.api.agent.onNotification((notification) => inbox.receive(notification))
    return () => {
      unsubscribeStore()
      unsubscribe()
      inbox.destroy()
    }
  }, [inbox])

  return {
    ...snapshot,
    openNotification: (notificationId: string) => inbox.open(notificationId),
    dismissToast: () => inbox.dismissToast(),
    closeList: () => inbox.closeList(),
    toggleList: () => inbox.toggleList(),
    selectNotification: (notificationId: string) => inbox.select(notificationId),
    clearSelection: () => inbox.clearSelection(),
    markAllRead: () => inbox.markAllRead(),
  }
}
