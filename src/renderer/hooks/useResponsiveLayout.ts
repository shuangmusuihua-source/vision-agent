import { useState, useEffect, useRef, useCallback } from 'react'
import { useDividerDrag } from './useDividerDrag'

const SIDEBAR_AUTO_COLLAPSE_BREAKPOINT = 1200
const AGENT_OVERLAY_BREAKPOINT = 900
const EXPANDED_SIDEBAR_WIDTH = 220
const DIVIDER_ZONE_WIDTH = 12
const AGENT_MIN_WIDTH = 240

export function getDefaultAgentPanelWidth(viewportWidth: number, sidebarCollapsed: boolean): number {
  const sidebarWidth = sidebarCollapsed ? 0 : EXPANDED_SIDEBAR_WIDTH
  const panelAreaWidth = Math.max(0, viewportWidth - sidebarWidth - DIVIDER_ZONE_WIDTH)
  return Math.max(AGENT_MIN_WIDTH, Math.round(panelAreaWidth / 2))
}

/**
 * Layout state — sidebar, agent panel, divider, responsive behavior.
 * Extracted from AppShell to keep it focused on workspace orchestration.
 */
export function useResponsiveLayout() {
  const initialViewportWidth = typeof window === 'undefined' ? SIDEBAR_AUTO_COLLAPSE_BREAKPOINT : window.innerWidth
  const initialSidebarCollapsed = initialViewportWidth < SIDEBAR_AUTO_COLLAPSE_BREAKPOINT
  const initialAgentCollapsed = initialViewportWidth < AGENT_OVERLAY_BREAKPOINT
  const [sidebarCollapsed, setSidebarCollapsed] = useState(initialSidebarCollapsed)
  const [agentWidth, setAgentWidth] = useState(() => initialAgentCollapsed
    ? 0
    : getDefaultAgentPanelWidth(initialViewportWidth, initialSidebarCollapsed))
  const [agentCollapsed, setAgentCollapsed] = useState(initialAgentCollapsed)
  const [isChatFirst, setIsChatFirst] = useState(true)
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
      if (w < AGENT_OVERLAY_BREAKPOINT) {
        setSidebarCollapsed(true)
        setAgentWidth(0)
        setAgentCollapsed(true)
      } else if (w < SIDEBAR_AUTO_COLLAPSE_BREAKPOINT) {
        setSidebarCollapsed(true)
        if (agentCollapsed) {
          setAgentWidth(getDefaultAgentPanelWidth(w, true))
          setAgentCollapsed(false)
        }
      } else if (agentCollapsed) {
        setAgentWidth(getDefaultAgentPanelWidth(w, sidebarCollapsed))
        setAgentCollapsed(false)
      }
    }
    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [agentCollapsed, sidebarCollapsed, setAgentCollapsed, setAgentWidth])

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
