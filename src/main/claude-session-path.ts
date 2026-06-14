import { existsSync, readdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

export function legacyClaudeProjectDir(workspacePath: string): string {
  return workspacePath.replace(/\//g, '-')
}

export function resolveClaudeSessionJsonlPath(
  sessionId: string,
  workspacePath?: string | null,
  projectsRoot = join(homedir(), '.claude', 'projects')
): string | null {
  if (!sessionId) return null

  if (workspacePath) {
    const legacyPath = join(projectsRoot, legacyClaudeProjectDir(workspacePath), `${sessionId}.jsonl`)
    if (existsSync(legacyPath)) return legacyPath
  }

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
