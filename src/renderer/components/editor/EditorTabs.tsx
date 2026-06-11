import { useCallback, useRef, useEffect, useState } from 'react'
import { X, ChevronLeft, ChevronRight, LayoutDashboard } from 'lucide-react'
import type { TabDescriptor } from '../../../shared/types'
import { isFileTab, isFixedTab, tabKey } from '../../../shared/types'

interface EditorTabsProps {
  tabs: TabDescriptor[]
  activeTab: TabDescriptor | null
  onTabSwitch: (tab: TabDescriptor) => void
  onTabClose: (tab: TabDescriptor) => void
}

function getFileName(path: string): string {
  return path.split('/').pop() || path
}

function EditorTabs({ tabs, activeTab, onTabSwitch, onTabClose }: EditorTabsProps): React.ReactElement {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)

  const activeKey = activeTab ? tabKey(activeTab) : ''

  const updateScrollState = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    setCanScrollLeft(el.scrollLeft > 0)
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1)
  }, [])

  useEffect(() => {
    updateScrollState()
  }, [tabs, updateScrollState])

  // Scroll active tab into view
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const activeEl = el.querySelector('.editor-tab-active') as HTMLElement | null
    if (!activeEl) return

    const containerLeft = el.scrollLeft
    const containerRight = el.scrollLeft + el.clientWidth
    const tabLeft = activeEl.offsetLeft
    const tabRight = activeEl.offsetLeft + activeEl.offsetWidth

    if (tabLeft < containerLeft) {
      el.scrollTo({ left: tabLeft, behavior: 'smooth' })
    } else if (tabRight > containerRight) {
      el.scrollTo({ left: tabRight - el.clientWidth, behavior: 'smooth' })
    }
  }, [activeKey])

  const scroll = useCallback((direction: 'left' | 'right') => {
    const el = scrollRef.current
    if (!el) return
    const amount = el.clientWidth * 0.6
    el.scrollBy({ left: direction === 'left' ? -amount : amount, behavior: 'smooth' })
  }, [])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return

    const onScrollEnd = () => updateScrollState()
    el.addEventListener('scrollend', onScrollEnd)
    el.addEventListener('scroll', updateScrollState)
    return () => {
      el.removeEventListener('scrollend', onScrollEnd)
      el.removeEventListener('scroll', updateScrollState)
    }
  }, [updateScrollState])

  const handleClose = useCallback((e: React.MouseEvent, tab: TabDescriptor) => {
    e.stopPropagation()
    onTabClose(tab)
  }, [onTabClose])

  // Separate fixed tabs from file tabs
  const fixedTabs = tabs.filter(isFixedTab)
  const fileTabs = tabs.filter(isFileTab)
  const hasBoth = fixedTabs.length > 0 && fileTabs.length > 0

  return (
    <div className="editor-tabs-container">
      {canScrollLeft && (
        <button className="editor-tabs-nav editor-tabs-nav-left" onClick={() => scroll('left')}>
          <ChevronLeft size={14} />
        </button>
      )}
      <div className="editor-tabs" ref={scrollRef}>
        {/* Fixed tabs */}
        {fixedTabs.map((tab) => {
          const key = tabKey(tab)
          const isActive = key === activeKey
          return (
            <div
              key={key}
              className={`editor-tab editor-tab-fixed ${isActive ? 'editor-tab-active' : ''}`}
              onClick={() => onTabSwitch(tab)}
              title="会话概览"
            >
              <LayoutDashboard size={13} className="editor-tab-fixed-icon" />
              <span className="editor-tab-name">概览</span>
            </div>
          )
        })}

        {/* Separator between fixed and file tabs */}
        {hasBoth && <span className="editor-tabs-separator" />}

        {/* File tabs */}
        {fileTabs.map((tab) => {
          const key = tabKey(tab)
          const isActive = key === activeKey
          return (
            <div
              key={key}
              className={`editor-tab ${isActive ? 'editor-tab-active' : ''}`}
              onClick={() => onTabSwitch(tab)}
              title={tab.path}
            >
              <span className="editor-tab-name">{getFileName(tab.path)}</span>
              <button
                className="editor-tab-close"
                onClick={(e) => handleClose(e, tab)}
              >
                <X size={12} />
              </button>
            </div>
          )
        })}
      </div>
      {canScrollRight && (
        <button className="editor-tabs-nav editor-tabs-nav-right" onClick={() => scroll('right')}>
          <ChevronRight size={14} />
        </button>
      )}
    </div>
  )
}

export default EditorTabs
