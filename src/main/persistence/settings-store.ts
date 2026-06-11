import { store, type CronTask } from './store-core'
import { getBuiltinSkills } from '../skills/builtin'

// ─── Theme ──────────────────────────────────────────────────────────────

export function getTheme(): 'light' | 'dark' | 'system' {
  return store.get('theme')
}

export function setTheme(theme: 'light' | 'dark' | 'system'): void {
  store.set('theme', theme)
}

// ─── Cron tasks ─────────────────────────────────────────────────────────

export function getCronTasks(): CronTask[] {
  return store.get('cronTasks') || []
}

export function saveCronTasks(tasks: CronTask[]): void {
  store.set('cronTasks', tasks)
}

// ─── Enabled skills ─────────────────────────────────────────────────────

export function getEnabledSkills(): string[] {
  const stored = store.get('enabledSkills')
  const builtins = getBuiltinSkills().map((s: { id: string }) => s.id)
  if (!stored || stored.length === 0) {
    return builtins
  }
  const merged = [...stored]
  for (const id of builtins) {
    if (!merged.includes(id)) merged.push(id)
  }
  if (merged.length !== stored.length) {
    store.set('enabledSkills', merged)
  }
  return merged
}

export function setEnabledSkills(skillIds: string[]): void {
  store.set('enabledSkills', skillIds)
}

export function toggleSkill(skillId: string, enabled: boolean): string[] {
  let current = store.get('enabledSkills')
  if (!current || current.length === 0) {
    current = getBuiltinSkills().map((s: { id: string }) => s.id)
  }
  let next: string[]
  if (enabled) {
    next = current.includes(skillId) ? current : [...current, skillId]
  } else {
    next = current.filter((id) => id !== skillId)
  }
  store.set('enabledSkills', next)
  return next
}

// ─── Compaction session IDs (persisted for restart survival) ────────────

const COMPACTION_IDS_KEY = 'compactionSessionIds'
const MAX_COMPACTION_IDS = 200

export function getCompactionSessionIds(): string[] {
  return (store.get(COMPACTION_IDS_KEY) as string[]) || []
}

export function addCompactionSessionId(id: string): void {
  let current = getCompactionSessionIds()
  if (!current.includes(id)) {
    current.push(id)
    // Enforce upper bound — drop oldest entries first (array preserves insertion order)
    if (current.length > MAX_COMPACTION_IDS) {
      current = current.slice(current.length - MAX_COMPACTION_IDS)
    }
    store.set(COMPACTION_IDS_KEY, current)
  }
}

export function deleteCompactionSessionId(id: string): void {
  const current = getCompactionSessionIds()
  store.set(COMPACTION_IDS_KEY, current.filter((x) => x !== id))
}
