import { existsSync, readdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

export function resolveClaudeSessionJsonlPath(
  sessionId: string,
  projectsRoot = join(homedir(), '.claude', 'projects')
): string | null {
  if (!sessionId) return null

  try {
    for (const entry of readdirSync(projectsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const candidate = join(projectsRoot, entry.name, `${sessionId}.jsonl`)
      if (existsSync(candidate)) return candidate
    }
  } catch {
    return null
  }

  return null
}
