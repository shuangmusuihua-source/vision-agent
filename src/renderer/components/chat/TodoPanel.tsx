import { useState } from 'react'
import { ChevronUp, ChevronDown, X, Loader2, Check } from 'lucide-react'
import type { TodoTaskList } from '../../../shared/types'
import styles from './TodoPanel.module.css'

interface TodoPanelProps {
  todoList: TodoTaskList
  onClose: () => void
}

function statusIcon(status: string) {
  if (status === 'completed') return <Check size={12} className={styles.iconDone} />
  if (status === 'in_progress') return <Loader2 size={12} className={`spin ${styles.iconActive}`} />
  return <span className={styles.iconPending} />
}

function statusLabel(status: string) {
  if (status === 'completed') return '✅'
  if (status === 'in_progress') return '🔧'
  return '⏳'
}

export default function TodoPanel({ todoList, onClose }: TodoPanelProps) {
  const [expanded, setExpanded] = useState(true)

  const completed = todoList.tasks.filter((t) => t.status === 'completed').length
  const inProgress = todoList.tasks.find((t) => t.status === 'in_progress')
  const total = todoList.tasks.length
  const allDone = completed === total
  const progressText = allDone ? '全部完成' : inProgress?.subject || '准备中'

  if (todoList.tasks.length === 0) return null

  return (
    <div className={`${styles.panel} ${expanded ? styles.expanded : styles.collapsed}`}>
      {/* Collapsed bar */}
      <div className={styles.bar} onClick={() => setExpanded(!expanded)}>
        <span className={styles.barLeft}>
          {allDone ? (
            <Check size={14} className={styles.iconDone} />
          ) : (
            <Loader2 size={14} className={`spin ${styles.iconActive}`} />
          )}
          <span className={styles.barText}>{progressText}</span>
          <span className={styles.barCount}>({completed}/{total})</span>
        </span>
        <span className={styles.barRight}>
          <button
            className={styles.btn}
            onClick={(e) => { e.stopPropagation(); setExpanded(!expanded) }}
            title={expanded ? '收起' : '展开'}
          >
            {expanded ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </button>
          <button
            className={styles.btn}
            onClick={(e) => { e.stopPropagation(); onClose() }}
            title="关闭"
          >
            <X size={14} />
          </button>
        </span>
      </div>

      {/* Expanded timeline */}
      {expanded && (
        <div className={styles.timeline}>
          {todoList.tasks.map((task, i) => (
            <div key={task.taskId} className={`${styles.task} ${styles[`task-${task.status}`]}`}>
              <span className={styles.taskIcon}>{statusIcon(task.status)}</span>
              <span className={styles.taskLabel}>{statusLabel(task.status)}</span>
              <span className={styles.taskSubject}>
                {task.subject}
                {task.description && (
                  <span className={styles.taskDesc}> — {task.description}</span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
