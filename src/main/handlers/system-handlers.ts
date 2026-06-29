import { registerMemoryHandlers } from './memory-handlers'
import { registerCronHandlers } from './cron-handlers'
import { registerGraphHandlers } from './graph-handlers'
import { registerSkillHandlers } from './skill-handlers'
import { registerSearchHandlers } from './search-handlers'
import { registerNotificationHandlers } from './notification-handlers'
import { registerConnectionHandlers } from './connection-handlers'
import { registerAttachmentHandlers } from './attachment-handlers'

export function registerSystemHandlers(): void {
  registerMemoryHandlers()
  registerCronHandlers()
  registerGraphHandlers()
  registerSkillHandlers()
  registerSearchHandlers()
  registerNotificationHandlers()
  registerConnectionHandlers()
  registerAttachmentHandlers()
}
