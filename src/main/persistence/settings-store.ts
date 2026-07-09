import { existsSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { store, type CronTask } from './store-core'
import { getBuiltinSkills } from '../skills/builtin'
import { getAppSkillsDir } from '../skill-init'
import { resolveEnabledSkillIds, updateSkillPreference } from '../../shared/skill-settings'

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

function getInstalledCommunitySkillIds(builtinSkillIds: string[]): string[] {
  const builtin = new Set(builtinSkillIds)
  try {
    return readdirSync(getAppSkillsDir(), { withFileTypes: true })
      .filter(entry => (
        entry.isDirectory()
        && !entry.name.startsWith('.')
        && !entry.name.includes('.staging-')
        && !entry.name.includes('.backup-')
        && !builtin.has(entry.name)
        && existsSync(join(getAppSkillsDir(), entry.name, 'SKILL.md'))
        && statSync(join(getAppSkillsDir(), entry.name, 'SKILL.md')).isFile()
      ))
      .map(entry => entry.name)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

export function getEnabledSkills(): string[] {
  const stored = store.get('enabledSkills') || []
  const disabled = store.get('disabledSkills') || []
  const builtins = getBuiltinSkills().map((s: { id: string }) => s.id)
  const available = [...builtins, ...getInstalledCommunitySkillIds(builtins)]
  const resolved = resolveEnabledSkillIds(stored, builtins, disabled, available)
  if (resolved.length !== stored.length || resolved.some((skillId, index) => skillId !== stored[index])) {
    store.set('enabledSkills', resolved)
  }
  return resolved
}

export function setEnabledSkills(skillIds: string[]): void {
  store.set('enabledSkills', skillIds)
  const enabled = new Set(skillIds)
  store.set('disabledSkills', (store.get('disabledSkills') || []).filter(skillId => !enabled.has(skillId)))
}

export function toggleSkill(skillId: string, enabled: boolean): string[] {
  const next = updateSkillPreference(
    getEnabledSkills(),
    store.get('disabledSkills') || [],
    skillId,
    enabled,
  )
  store.set('enabledSkills', next.enabledSkillIds)
  store.set('disabledSkills', next.disabledSkillIds)
  return next.enabledSkillIds
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
