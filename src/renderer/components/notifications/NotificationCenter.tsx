import { lazy, Suspense, useEffect, useRef } from 'react'
import { Bell, CheckCheck, ChevronLeft, ChevronRight, ExternalLink, ShieldCheck, CircleCheck, CircleAlert, X } from 'lucide-react'
import { useNotificationInbox } from '../../hooks/useNotificationInbox'
import { getNotificationTargetLabel, notificationDateTimeLabel, notificationTimeLabel, type AppNotification } from '../../notifications/notification-inbox'

const AssistantMarkdown = lazy(() => import('../chat/AssistantMarkdown'))

function NotificationIcon({ notification }: { notification: AppNotification }): React.ReactElement {
  const Icon = notification.permissionRequestId ? ShieldCheck : notification.type === 'error' ? CircleAlert : notification.type === 'success' ? CircleCheck : Bell
  return <span className={`notification-icon notification-icon-${notification.type}`}><Icon size={16} /></span>
}

function NotificationCenter({ onNavigate }: { onNavigate: (notification: AppNotification) => void }): React.ReactElement {
  const inbox = useNotificationInbox()
  const { toast, listOpen, selected, notifications, unreadCount } = inbox
  const areaRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const closeRef = useRef(inbox.closeList)
  closeRef.current = inbox.closeList
  useEffect(() => {
    if (!listOpen) return
    const onPointer = (event: MouseEvent) => {
      if (!areaRef.current?.contains(event.target as Node)) closeRef.current()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      closeRef.current()
      triggerRef.current?.focus()
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [listOpen])
  const handleOpen = (notification: AppNotification) => {
    const current = inbox.openNotification(notification.id)
    if (current) onNavigate(current)
  }
  const visible = notifications.filter((item) => !item.read || item.permissionRequestId)
  return <>
    <div className="notification-inbox-area" ref={areaRef}>
      <button ref={triggerRef} className={`notification-inbox-button${listOpen ? ' notification-inbox-button-active' : ''}`} onClick={inbox.toggleList}
        aria-label={`未读通知 ${unreadCount} 条`} title="通知" aria-expanded={listOpen} aria-controls="notification-inbox-panel">
        <Bell size={16} />{unreadCount > 0 && <span>{unreadCount > 99 ? '99+' : unreadCount}</span>}
      </button>
      {listOpen && <div id="notification-inbox-panel" className="notification-inbox-panel" role="dialog" aria-label="通知">
        {selected ? <>
          <div className="notification-inbox-head">
            <button onClick={inbox.clearSelection}><ChevronLeft size={14} />返回</button>
            {getNotificationTargetLabel(selected) && <button onClick={() => handleOpen(selected)}><ExternalLink size={14} />查看来源</button>}
          </div>
          <article className="notification-detail-card">
            <div className="notification-detail-title"><strong>{selected.title || '通知'}</strong><span>{notificationDateTimeLabel(selected.receivedAt)} · {getNotificationTargetLabel(selected) || 'sumi'}</span></div>
            <div className="notification-detail-markdown message-markdown"><Suspense fallback={<span>{selected.message}</span>}><AssistantMarkdown text={selected.message} isStreaming={false} /></Suspense></div>
          </article>
        </> : <>
          <div className="notification-inbox-head">
            <span className="notification-icon"><Bell size={16} /></span>
            <div className="notification-heading"><strong>通知</strong><span>{unreadCount ? `${unreadCount} 条未读` : visible.length ? '仍有请求等待确认' : '消息已读完'}</span></div>
            <button onClick={inbox.markAllRead} disabled={!unreadCount} title="全部标记已读"><CheckCheck size={14} />全部已读</button>
          </div>
          {visible.length ? <div className="notification-inbox-list">{visible.map((item) => <button key={item.id} className="notification-inbox-item" onClick={() => item.permissionRequestId ? handleOpen(item) : inbox.selectNotification(item.id)}>
            <NotificationIcon notification={item} />
            <div className="notification-inbox-copy">
              <div className="notification-inbox-item-head"><strong>{item.title || '通知'}</strong><time>{notificationTimeLabel(item.receivedAt)}</time></div>
              <p>{item.message}</p>
              <span className="notification-source">{getNotificationTargetLabel(item) || 'sumi'}{item.permissionRequestId && ' · 前往确认'}</span>
            </div><ChevronRight size={13} className="notification-chevron" />
          </button>)}</div> : <div className="notification-inbox-empty"><CheckCheck size={24} /><strong>都处理好了</strong><span>新的消息会显示在这里</span></div>}
        </>}
      </div>}
    </div>
    {toast && !listOpen && <div className="app-toast" aria-live={toast.type === 'error' ? 'assertive' : 'polite'}>
      <button className="app-toast-content" onClick={() => handleOpen(toast)}><NotificationIcon notification={toast} /><span className="app-toast-copy"><strong>{toast.title || '通知'}</strong><span>{toast.message}</span></span></button>
      <button className="app-toast-close" aria-label="关闭通知" onClick={inbox.dismissToast}><X size={14} /></button>
    </div>}
  </>
}
export default NotificationCenter
