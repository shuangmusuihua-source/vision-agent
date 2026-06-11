import { useState, useEffect, useRef, useCallback } from 'react'
import { useDividerDrag } from './useDividerDrag'

/**
 * Layout state — sidebar, agent panel, divider, responsive behavior.
 * Extracted from AppShell to keep it focused on workspace orchestration.
 */
export function useResponsiveLayout() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [agentWidth, setAgentWidth] = useState(360)
  const [agentCollapsed, setAgentCollapsed] = useState(false)
  const [isChatFirst, setIsChatFirst] = useState(false)
  const shellRef = useRef<HTMLDivElement>(null)

  const {
    dividerHovered, setDividerHovered, isDragging,
    handleSwapLayout, handleExpand, handleToggleAgent, handleDividerMouseDown,
  } = useDividerDrag({
    agentCollapsed, agentWidth, isChatFirst,
    setAgentWidth, setAgentCollapsed, shellRef,
    onSwapLayout: () => setIsChatFirst((v) => !v),
  })

  // Responsive auto-collapse
  useEffect(() => {
    const handleResize = () => {
      const w = window.innerWidth
      if (w < 900) { setSidebarCollapsed(true); setAgentWidth(0); setAgentCollapsed(true) }
      else if (w < 1200) { setSidebarCollapsed(true); if (agentCollapsed) handleExpand() }
    }
    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [agentCollapsed])

  // Toggle auto-hide
  const [toggleVisible, setToggleVisible] = useState(true)
  const toggleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    toggleTimerRef.current = setTimeout(() => setToggleVisible(false), 3000)
    return () => { if (toggleTimerRef.current) clearTimeout(toggleTimerRef.current) }
  }, [])
  const handleToggleMouseEnter = useCallback(() => {
    if (toggleTimerRef.current) clearTimeout(toggleTimerRef.current)
    setToggleVisible(true)
  }, [])
  const handleToggleMouseLeave = useCallback(() => {
    toggleTimerRef.current = setTimeout(() => setToggleVisible(false), 3000)
  }, [])

  return {
    sidebarCollapsed, setSidebarCollapsed,
    agentWidth, agentCollapsed,
    isChatFirst, setIsChatFirst,
    shellRef,
    dividerHovered, setDividerHovered, isDragging,
    handleSwapLayout, handleExpand, handleToggleAgent, handleDividerMouseDown,
    toggleVisible, handleToggleMouseEnter, handleToggleMouseLeave,
  }
}
