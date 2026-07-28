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
      <rect x="3.1" y="3.1" width="5.4" height="5.4" rx="1.5" />
      <rect x="11.5" y="3.1" width="5.4" height="5.4" rx="1.5" />
      <rect x="3.1" y="11.5" width="5.4" height="5.4" rx="1.5" />
      <path d="M11.5 14.2h5.4M14.2 11.5v5.4" />
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
      <rect x="3.2" y="4.05" width="3.55" height="11.35" rx="1.1" />
      <rect x="7.65" y="2.95" width="4.05" height="12.45" rx="1.1" />
      <path d="m13.05 4.35 3.1-.55 1.65 10.85-3.1.5-1.65-10.8Z" />
      <path d="M2.7 17.05h14.6" />
    </SidebarPrimaryIcon>
  )
}
