import { useCallback, useRef, useEffect, useState } from 'react'
import { X, CaretLeft, CaretRight } from '@phosphor-icons/react'

interface EditorTabsProps {
  tabs: string[]
  activeTab: string
  onTabSwitch: (path: string) => void
  onTabClose: (path: string) => void
}

function EditorTabs({ tabs, activeTab, onTabSwitch, onTabClose }: EditorTabsProps): React.ReactElement {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)

  const getFileName = (path: string): string => {
    return path.split('/').pop() || path
  }

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
  }, [activeTab])

  const scroll = useCallback((direction: 'left' | 'right') => {
    const el = scrollRef.current
    if (!el) return
    const amount = el.clientWidth * 0.6
    el.scrollBy({ left: direction === 'left' ? -amount : amount, behavior: 'smooth' })
    setTimeout(updateScrollState, 300)
  }, [updateScrollState])

  const handleClose = useCallback((e: React.MouseEvent, path: string) => {
    e.stopPropagation()
    onTabClose(path)
  }, [onTabClose])

  const handleScroll = useCallback(() => {
    updateScrollState()
  }, [updateScrollState])

  return (
    <div className="editor-tabs-container">
      {canScrollLeft && (
        <button className="editor-tabs-nav editor-tabs-nav-left" onClick={() => scroll('left')}>
          <CaretLeft size={14} weight="regular" />
        </button>
      )}
      <div className="editor-tabs" ref={scrollRef} onScroll={handleScroll}>
        {tabs.map((path) => (
          <div
            key={path}
            className={`editor-tab ${path === activeTab ? 'editor-tab-active' : ''}`}
            onClick={() => onTabSwitch(path)}
            title={path}
          >
            <span className="editor-tab-name">{getFileName(path)}</span>
            <button
              className="editor-tab-close"
              onClick={(e) => handleClose(e, path)}
            >
              <X size={12} weight="regular" />
            </button>
          </div>
        ))}
      </div>
      {canScrollRight && (
        <button className="editor-tabs-nav editor-tabs-nav-right" onClick={() => scroll('right')}>
          <CaretRight size={14} weight="regular" />
        </button>
      )}
    </div>
  )
}

export default EditorTabs