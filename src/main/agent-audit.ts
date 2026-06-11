import { app } from 'electron'
import { join } from 'path'
import { appendFile } from 'fs/promises'

const AUDIT_LOG_PATH = join(app.getPath('userData'), 'audit.log')

const AUDIT_REDACT_PATTERNS = [
  /(?:api[_-]?key|apikey|secret|token|password|auth)\s*[:=]\s*['"]?[^\s'"]+['"]?/gi,
  /sk-[a-zA-Z0-9]{20,}/g,
  /(?:Bearer\s+)[a-zA-Z0-9._\-]+/g,
]

function redactCredentials(text: string): string {
  let result = text
  for (const pattern of AUDIT_REDACT_PATTERNS) {
    result = result.replace(pattern, (m) => m.slice(0, 4) + '***[REDACTED]')
  }
  return result
}

// ─── Buffered audit log writer ────────────────────────────────────────
// Replaces per-call `await appendFile` with buffered batching (flush every 5s).
// Each tool invocation triggers 2 log entries (PreToolUse + PostToolUse) —
// with the old approach, both were inline `await`s blocking the hook chain.
// Now writes are fire-and-forget, with a lazy timer that flushes the buffer.

const auditBuffer: string[] = []
let auditFlushTimer: ReturnType<typeof setTimeout> | null = null
const AUDIT_FLUSH_MS = 5_000

function scheduleAuditFlush(): void {
  if (auditFlushTimer) return
  auditFlushTimer = setTimeout(async () => {
    auditFlushTimer = null
    if (auditBuffer.length === 0) return
    const batch = auditBuffer.splice(0)
    try {
      await appendFile(AUDIT_LOG_PATH, batch.join(''), { encoding: 'utf-8' })
    } catch {
      // Audit log write failure should not block agent
    }
  }, AUDIT_FLUSH_MS)
}

export function writeAuditLog(entry: Record<string, unknown>): void {
  try {
    const line = JSON.stringify({ timestamp: new Date().toISOString(), ...entry }) + '\n'
    auditBuffer.push(redactCredentials(line))
    scheduleAuditFlush()
  } catch {
    // silently drop — audit failures must never break agent flow
  }
}

/**
 * Flush the audit log buffer immediately. Called on app quit to ensure
 * pending entries are written before the process exits.
 */
export async function flushAuditLog(): Promise<void> {
  if (auditFlushTimer) {
    clearTimeout(auditFlushTimer)
    auditFlushTimer = null
  }
  if (auditBuffer.length === 0) return
  const batch = auditBuffer.splice(0)
  try {
    await appendFile(AUDIT_LOG_PATH, batch.join(''), { encoding: 'utf-8' })
  } catch {
    // Audit log write failure should not block app exit
  }
}
