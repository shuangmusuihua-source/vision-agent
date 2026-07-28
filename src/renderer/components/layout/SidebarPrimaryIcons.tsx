import type { ReactNode } from 'react'

interface SidebarPrimaryIconProps {
  children: ReactNode
}

function SidebarPrimaryIcon({ children }: SidebarPrimaryIconProps): React.ReactElement {
  return (
    <svg
      className="sidebar-primary-icon-svg"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  )
}

export function AskSumiIcon(): React.ReactElement {
  return (
    <SidebarPrimaryIcon>
      <path d="M10 3.1c-3.9 0-6.7 2.42-6.7 5.58 0 1.65.78 3.13 2.16 4.16l-.56 3.07 3.14-1.48c.63.13 1.29.2 1.96.2 3.9 0 6.7-2.48 6.7-5.95S13.9 3.1 10 3.1Z" />
      <path d="M10 6.25v4.85M7.58 8.68h4.84" />
    </SidebarPrimaryIcon>
  )
}

export function SkillsIcon(): React.ReactElement {
  return (
    <SidebarPrimaryIcon>
      <rect x="3.15" y="3.15" width="6.05" height="6.05" rx="1.75" />
      <rect x="10.8" y="3.15" width="6.05" height="6.05" rx="1.75" />
      <rect x="6.98" y="10.8" width="6.05" height="6.05" rx="1.75" />
    </SidebarPrimaryIcon>
  )
}

export function AutomationIcon(): React.ReactElement {
  return (
    <SidebarPrimaryIcon>
      <path d="m5.28 3.72-1.6 1.62M14.72 3.72l1.6 1.62" />
      <circle cx="10" cy="10.4" r="6.05" />
      <path d="M10 7.05v3.68l2.45 1.47M5.38 15.28l-1.2 1.48M14.62 15.28l1.2 1.48" />
    </SidebarPrimaryIcon>
  )
}

export function KnowledgeIcon(): React.ReactElement {
  return (
    <SidebarPrimaryIcon>
      <path d="M4.05 3.45h10.1a1.8 1.8 0 0 1 1.8 1.8v11.3H6.4a2.35 2.35 0 0 1-2.35-2.35V3.45Z" />
      <path d="M4.05 13.75c.6-.7 1.38-1.05 2.35-1.05h9.55" />
      <path d="M7.15 3.45v5.3l1.9-1.2 1.9 1.2v-5.3" />
    </SidebarPrimaryIcon>
  )
}
