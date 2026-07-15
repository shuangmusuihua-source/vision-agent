import { registerMemoryHandlers } from './memory-handlers'
import { registerCronHandlers } from './cron-handlers'
import { registerGraphHandlers } from './graph-handlers'
import { registerSkillHandlers } from './skill-handlers'
import { registerSearchHandlers } from './search-handlers'
import { registerConnectionHandlers } from './connection-handlers'
import { registerAttachmentHandlers } from './attachment-handlers'
import { registerOfficeHandlers } from './office-handlers'

export function registerSystemHandlers(): void {
  registerMemoryHandlers()
  registerCronHandlers()
  registerGraphHandlers()
  registerSkillHandlers()
  registerSearchHandlers()
  registerConnectionHandlers()
  registerAttachmentHandlers()
  registerOfficeHandlers()
}
