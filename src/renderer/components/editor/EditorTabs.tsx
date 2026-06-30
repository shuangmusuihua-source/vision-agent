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
  const tabRefs = useRef(new Map<string, HTMLButtonElement>())
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
  const orderedTabs = [...fixedTabs, ...fileTabs]

  const handleTabKeyDown = useCallback((event: React.KeyboardEvent, tab: TabDescriptor) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onTabSwitch(tab)
      return
    }
    const currentIndex = orderedTabs.findIndex(candidate => tabKey(candidate) === tabKey(tab))
    let nextIndex = -1
    if (event.key === 'ArrowLeft') nextIndex = Math.max(0, currentIndex - 1)
    if (event.key === 'ArrowRight') nextIndex = Math.min(orderedTabs.length - 1, currentIndex + 1)
    if (event.key === 'Home') nextIndex = 0
    if (event.key === 'End') nextIndex = orderedTabs.length - 1
    if (nextIndex < 0 || nextIndex === currentIndex) return
    event.preventDefault()
    const nextTab = orderedTabs[nextIndex]
    onTabSwitch(nextTab)
    requestAnimationFrame(() => tabRefs.current.get(tabKey(nextTab))?.focus())
  }, [onTabSwitch, orderedTabs])

  return (
    <div className="editor-tabs-container">
      {canScrollLeft && (
        <button className="editor-tabs-nav editor-tabs-nav-left" onClick={() => scroll('left')} aria-label="向左滚动标签">
          <ChevronLeft size={14} />
        </button>
      )}
      <div className="editor-tabs" ref={scrollRef} role="tablist" aria-label="已打开的文档">
        {/* Fixed tabs */}
        {fixedTabs.map((tab) => {
          const key = tabKey(tab)
          const isActive = key === activeKey
          return (
            <div
              key={key}
              className={`editor-tab editor-tab-fixed ${isActive ? 'editor-tab-active' : ''}`}
              title="会话概览"
            >
              <button
                type="button"
                className="editor-tab-trigger"
                role="tab"
                aria-selected={isActive}
                tabIndex={isActive ? 0 : -1}
                ref={(element) => { if (element) tabRefs.current.set(key, element); else tabRefs.current.delete(key) }}
                onClick={() => onTabSwitch(tab)}
                onKeyDown={(event) => handleTabKeyDown(event, tab)}
              >
                <LayoutDashboard size={13} className="editor-tab-fixed-icon" />
                <span className="editor-tab-name">概览</span>
              </button>
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
              title={tab.path}
            >
              <button
                type="button"
                className="editor-tab-trigger"
                role="tab"
                aria-selected={isActive}
                tabIndex={isActive ? 0 : -1}
                ref={(element) => { if (element) tabRefs.current.set(key, element); else tabRefs.current.delete(key) }}
                onClick={() => onTabSwitch(tab)}
                onKeyDown={(event) => handleTabKeyDown(event, tab)}
              >
                <span className="editor-tab-name">{getFileName(tab.path)}</span>
              </button>
              <button
                className="editor-tab-close"
                onClick={(e) => handleClose(e, tab)}
                aria-label={`关闭 ${getFileName(tab.path)}`}
              >
                <X size={12} />
              </button>
            </div>
          )
        })}
      </div>
      {canScrollRight && (
        <button className="editor-tabs-nav editor-tabs-nav-right" onClick={() => scroll('right')} aria-label="向右滚动标签">
          <ChevronRight size={14} />
        </button>
      )}
    </div>
  )
}

export default EditorTabs
