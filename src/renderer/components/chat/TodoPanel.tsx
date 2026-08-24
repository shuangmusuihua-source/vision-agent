import { useId, useState } from 'react'
import { ChevronUp, ChevronDown, X, LoaderCircle, Circle, CircleCheck } from 'lucide-react'
import type { TodoTaskList } from '../../../shared/types'
import styles from './TodoPanel.module.css'

interface TodoPanelProps {
  todoList: TodoTaskList
  onClose: () => void
}

function statusIcon(status: string) {
  if (status === 'completed') {
    return <CircleCheck size={15} strokeWidth={1.8} className={styles.iconDone} aria-hidden="true" />
  }
  if (status === 'in_progress') {
    return <LoaderCircle size={15} strokeWidth={1.8} className={`spin ${styles.iconActive}`} aria-hidden="true" />
  }
  return <Circle size={15} strokeWidth={1.6} className={styles.iconPending} aria-hidden="true" />
}

function statusLabel(status: string): string {
  if (status === 'completed') return '已完成'
  if (status === 'in_progress') return '执行中'
  return '等待中'
}

export default function TodoPanel({ todoList, onClose }: TodoPanelProps) {
  const [expanded, setExpanded] = useState(false)
  const timelineId = useId()

  const completed = todoList.tasks.filter((t) => t.status === 'completed').length
  const inProgress = todoList.tasks.find((t) => t.status === 'in_progress')
  const total = todoList.tasks.length
  const allDone = completed === total
  const progressText = allDone ? '全部完成' : inProgress?.subject || '准备中'

  if (todoList.tasks.length === 0) return null

  return (
    <div className={`${styles.panel} ${expanded ? styles.expanded : styles.collapsed}`}>
      <div className={styles.bar}>
        <button
          type="button"
          className={styles.summaryButton}
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          aria-controls={timelineId}
          title={expanded ? '收起任务进度' : '展开任务进度'}
        >
          <span className={styles.barLeft} aria-live="polite" aria-atomic="true">
            {allDone ? (
              <CircleCheck size={16} strokeWidth={1.8} className={styles.iconDone} aria-hidden="true" />
            ) : (
              <LoaderCircle size={16} strokeWidth={1.8} className={`spin ${styles.iconActive}`} aria-hidden="true" />
            )}
            <span className={styles.barText}>{progressText}</span>
            <span className={styles.barCount}>{completed}/{total}</span>
          </span>
          {expanded
            ? <ChevronDown size={15} aria-hidden="true" />
            : <ChevronUp size={15} aria-hidden="true" />}
        </button>
        <button
          type="button"
          className={styles.dismissButton}
          onClick={onClose}
          title="隐藏任务进度"
          aria-label="隐藏任务进度"
        >
          <X size={14} aria-hidden="true" />
        </button>
      </div>

      {expanded && (
        <div id={timelineId} className={styles.timeline} role="list" aria-label="任务进度">
          {todoList.tasks.map((task) => (
            <div
              key={task.taskId}
              className={`${styles.task} ${styles[`task-${task.status}`]}`}
              role="listitem"
            >
              <span className={styles.taskIcon} role="img" aria-label={statusLabel(task.status)}>
                {statusIcon(task.status)}
              </span>
              <span className={styles.taskCopy}>
                <span className={styles.taskSubject}>{task.subject}</span>
                {task.description && <span className={styles.taskDesc}>{task.description}</span>}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
