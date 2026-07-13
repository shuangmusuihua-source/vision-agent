import { lazy, Suspense, useCallback } from 'react'
import { Bell, CheckCheck, ChevronLeft, ExternalLink } from 'lucide-react'
import { useNotificationInbox } from '../../hooks/useNotificationInbox'
import {
  getNotificationTargetLabel,
  notificationDateTimeLabel,
  notificationTimeLabel,
  type AppNotification,
} from '../../notifications/notification-inbox'

const AssistantMarkdown = lazy(() => import('../chat/AssistantMarkdown'))

interface NotificationCenterProps {
  onNavigate: (notification: AppNotification) => void
}

function NotificationCenter({ onNavigate }: NotificationCenterProps): React.ReactElement {
  const {
    toast,
    listOpen,
    selected,
    unreadNotifications,
    unreadCount,
    openNotification,
    dismissToast,
    toggleList,
    selectNotification,
    clearSelection,
    markAllRead,
  } = useNotificationInbox()

  const handleOpen = useCallback((notification: AppNotification) => {
    openNotification(notification.id)
    onNavigate(notification)
  }, [onNavigate, openNotification])

  const toastTone = toast?.type === 'error'
    ? 'error'
    : toast?.type === 'success'
      ? 'success'
      : 'info'

  return (
    <>
      {!toast && (unreadCount > 0 || listOpen) && (
        <div className="notification-inbox-area">
          <button
            className={`notification-inbox-button${listOpen ? ' notification-inbox-button-active' : ''}`}
            onClick={toggleList}
            aria-label={`未读通知 ${unreadCount} 条`}
            title={`未读通知 ${unreadCount} 条`}
          >
            <Bell size={16} />
            {unreadCount > 0 && <span>{unreadCount > 99 ? '99+' : unreadCount}</span>}
          </button>
          {listOpen && (
            <div className="notification-inbox-panel" role="dialog" aria-label="未读通知">
              {selected ? (
                <div className="notification-detail">
                  <div className="notification-inbox-head notification-detail-head">
                    <button className="notification-detail-back" onClick={clearSelection}>
                      <ChevronLeft size={14} />
                      返回
                    </button>
                    {getNotificationTargetLabel(selected) && (
                      <button className="notification-detail-source" onClick={() => handleOpen(selected)}>
                        <ExternalLink size={14} />
                        查看来源
                      </button>
                    )}
                  </div>
                  <article className={`notification-detail-card notification-inbox-item-${selected.type === 'error' ? 'error' : selected.type === 'success' ? 'success' : 'info'}`}>
                    <div className="notification-detail-title">
                      <strong>{selected.title || '通知'}</strong>
                      <span>
                        {notificationDateTimeLabel(selected.receivedAt)}
                        {getNotificationTargetLabel(selected) ? ` · ${getNotificationTargetLabel(selected)}` : ''}
                      </span>
                    </div>
                    <div className="notification-detail-markdown message-markdown">
                      <Suspense fallback={<span>{selected.message}</span>}>
                        <AssistantMarkdown text={selected.message} isStreaming={false} />
                      </Suspense>
                    </div>
                  </article>
                </div>
              ) : (
                <>
                  <div className="notification-inbox-head">
                    <strong>未读通知</strong>
                    <button onClick={markAllRead} disabled={unreadCount === 0} title="全部标记已读">
                      <CheckCheck size={14} />
                      全部已读
                    </button>
                  </div>
                  {unreadCount > 0 ? (
                    <div className="notification-inbox-list">
                      {unreadNotifications.map((notification) => (
                        <article
                          key={notification.id}
                          className={`notification-inbox-item notification-inbox-item-${notification.type === 'error' ? 'error' : notification.type === 'success' ? 'success' : 'info'}`}
                          role="button"
                          tabIndex={0}
                          onClick={() => selectNotification(notification.id)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault()
                              selectNotification(notification.id)
                            }
                          }}
                        >
                          <div className="notification-inbox-item-head">
                            <strong>{notification.title || '通知'}</strong>
                            <span>{notificationTimeLabel(notification.receivedAt)}</span>
                          </div>
                          <div className="notification-inbox-markdown message-markdown">
                            <Suspense fallback={<span>{notification.message}</span>}>
                              <AssistantMarkdown text={notification.message} isStreaming={false} />
                            </Suspense>
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <div className="notification-inbox-empty">没有未读通知</div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}
      {toast && (
        <div
          className={`app-toast app-toast-${toastTone}`}
          role="button"
          aria-live={toastTone === 'error' ? 'assertive' : 'polite'}
          tabIndex={0}
          onClick={() => handleOpen(toast)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              handleOpen(toast)
            }
          }}
        >
          <div className="app-toast-copy">
            <strong>{toast.title || '通知'}</strong>
            <div className="app-toast-markdown message-markdown">
              <Suspense fallback={<span>{toast.message}</span>}>
                <AssistantMarkdown text={toast.message} isStreaming={false} />
              </Suspense>
            </div>
          </div>
          <button
            className="app-toast-close"
            aria-label="关闭通知"
            onClick={(event) => {
              event.stopPropagation()
              dismissToast()
            }}
          >
            ✕
          </button>
        </div>
      )}
    </>
  )
}

export default NotificationCenter
