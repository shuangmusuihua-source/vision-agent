import {
  Blocks,
  Cable,
  CalendarClock,
  LibraryBig,
  MessageSquarePlus,
  type LucideIcon,
} from 'lucide-react'

interface SidebarPrimaryIconProps {
  icon: LucideIcon
}

function SidebarPrimaryIcon({ icon: Icon }: SidebarPrimaryIconProps): React.ReactElement {
  return (
    <Icon
      className="sidebar-primary-icon-svg"
      size={18}
      strokeWidth={1.6}
      aria-hidden="true"
      focusable="false"
    />
  )
}

export function AskSumiIcon(): React.ReactElement {
  return <SidebarPrimaryIcon icon={MessageSquarePlus} />
}

export function SkillsIcon(): React.ReactElement {
  return <SidebarPrimaryIcon icon={Blocks} />
}

export function AutomationIcon(): React.ReactElement {
  return <SidebarPrimaryIcon icon={CalendarClock} />
}

export function ConnectorsIcon(): React.ReactElement {
  return <SidebarPrimaryIcon icon={Cable} />
}

export function KnowledgeIcon(): React.ReactElement {
  return <SidebarPrimaryIcon icon={LibraryBig} />
}
