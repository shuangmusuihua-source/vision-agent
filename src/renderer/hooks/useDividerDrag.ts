import { useState, useCallback, useEffect, useRef } from 'react'

const AGENT_DEFAULT_WIDTH = 360
const AGENT_COLLAPSE_THRESHOLD = 180
const EDITOR_MIN_RATIO = 0.30

interface UseDividerDragOptions {
  agentCollapsed: boolean
  agentWidth: number
  isChatFirst: boolean
  setAgentWidth: (w: number) => void
  setAgentCollapsed: (v: boolean) => void
  shellRef: React.RefObject<HTMLDivElement | null>
  onSwapLayout: () => void
}

export function useDividerDrag({
  agentCollapsed,
  agentWidth,
  isChatFirst,
  setAgentWidth,
  setAgentCollapsed,
  shellRef,
  onSwapLayout,
}: UseDividerDragOptions) {
  const lastWidthRef = useRef(agentWidth || AGENT_DEFAULT_WIDTH)
  const [dividerHovered, setDividerHovered] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const dragStartXRef = useRef(0)
  const dragStartWidthRef = useRef(0)
  const layoutWidthRef = useRef(0)
  const rafRef = useRef<number>(0)
  const pendingWidthRef = useRef(0)

  const handleSwapLayout = useCallback(() => {
    onSwapLayout()
  }, [onSwapLayout])

  const handleExpand = useCallback(() => {
    setAgentWidth(lastWidthRef.current || AGENT_DEFAULT_WIDTH)
    setAgentCollapsed(false)
  }, [setAgentWidth, setAgentCollapsed])

  const handleToggleAgent = useCallback(() => {
    if (agentCollapsed) {
      setAgentWidth(lastWidthRef.current || AGENT_DEFAULT_WIDTH)
      setAgentCollapsed(false)
    } else {
      lastWidthRef.current = agentWidth
      setAgentWidth(0)
      setAgentCollapsed(true)
    }
  }, [agentCollapsed, agentWidth, setAgentWidth, setAgentCollapsed])

  const handleDividerMouseDown = useCallback((e: React.MouseEvent) => {
    if (agentCollapsed) return
    const target = e.target as HTMLElement
    if (target.closest('.divider-swap-btn') || target.closest('.divider-expand-btn')) return
    e.preventDefault()
    setIsDragging(true)
    setDividerHovered(true)
    dragStartXRef.current = e.clientX
    dragStartWidthRef.current = agentWidth
    const mainContentWidth = shellRef.current?.querySelector<HTMLElement>('.main-content')?.offsetWidth || 0
    layoutWidthRef.current = mainContentWidth + agentWidth || window.innerWidth
  }, [agentCollapsed, agentWidth, shellRef])

  useEffect(() => {
    if (!isDragging) return
    const onMouseMove = (e: MouseEvent) => {
      const delta = isChatFirst ? e.clientX - dragStartXRef.current : dragStartXRef.current - e.clientX
      const newWidth = Math.max(0, dragStartWidthRef.current + delta)
      const editorMinWidth = layoutWidthRef.current * EDITOR_MIN_RATIO
      const maxAgentWidth = layoutWidthRef.current - editorMinWidth
      const clamped = Math.min(newWidth, maxAgentWidth)
      pendingWidthRef.current = clamped
      if (clamped < AGENT_COLLAPSE_THRESHOLD) {
        cancelAnimationFrame(rafRef.current)
        lastWidthRef.current = dragStartWidthRef.current
        setAgentWidth(0)
        setAgentCollapsed(true)
        setIsDragging(false)
        setDividerHovered(false)
      } else if (!rafRef.current) {
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = 0
          setAgentWidth(pendingWidthRef.current)
          setAgentCollapsed(false)
        })
      }
    }
    const onMouseUp = () => {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = 0
      setAgentWidth(pendingWidthRef.current || dragStartWidthRef.current)
      setIsDragging(false)
      setDividerHovered(false)
    }
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    return () => {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = 0
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }
  }, [isDragging, isChatFirst, setAgentWidth, setAgentCollapsed])

  useEffect(() => {
    if (!agentCollapsed && agentWidth > 0) {
      lastWidthRef.current = agentWidth
    }
  }, [agentCollapsed, agentWidth])

  return {
    dividerHovered,
    setDividerHovered,
    isDragging,
    handleSwapLayout,
    handleExpand,
    handleToggleAgent,
    handleDividerMouseDown,
  }
}
