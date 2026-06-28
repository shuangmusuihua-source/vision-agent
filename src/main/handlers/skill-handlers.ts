import { BrowserWindow, ipcMain } from 'electron'
import { getEnabledSkills, toggleSkill } from '../store'
import { getBuiltinSkills } from '../skills/builtin'
import { getAppSkillsDir } from '../skill-init'
import {
  installCommunitySkill,
  inspectCommunitySkillInstallation,
  uninstallCommunitySkill,
} from '../community-skill-installer'
import { CURATED_COMMUNITY_SKILLS, getCuratedCommunitySkill } from '../skills/community-catalog'
import { sessionRuntime } from '../session-runtime'
import { runSkillMutation } from '../skill-mutation-coordinator'
import type { CommunitySkillCatalogItem, CommunitySkillMutationResult } from '../../shared/types'

function emitSkillsChanged(skillId: string, reason: 'installed' | 'updated' | 'uninstalled' | 'toggled'): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('skills:changed', { skillId, reason })
  }
}

async function getCommunityCatalog(): Promise<CommunitySkillCatalogItem[]> {
  const enabled = getEnabledSkills()
  return Promise.all(CURATED_COMMUNITY_SKILLS.map(async skill => {
    const installation = await inspectCommunitySkillInstallation(getAppSkillsDir(), skill.id)
    return {
      id: skill.id,
      name: skill.name,
      author: skill.author,
      category: skill.category,
      summary: skill.summary,
      description: skill.description,
      tags: skill.tags,
      sourcePageUrl: skill.sourcePageUrl,
      repositoryUrl: skill.repositoryUrl,
      audits: skill.audits,
      installed: Boolean(installation),
      enabled: Boolean(installation) && enabled.includes(skill.id),
      updateAvailable: Boolean(installation && installation.sourceRef !== skill.source.ref),
      installedAt: installation?.installedAt,
      updatedAt: installation?.updatedAt,
    }
  }))
}

export function registerSkillHandlers(): void {
  ipcMain.handle('skills:list', async () => {
    const communityCatalog = await getCommunityCatalog()
    const installedCommunity = CURATED_COMMUNITY_SKILLS
      .filter(skill => communityCatalog.some(item => item.id === skill.id && item.installed))
      .map(skill => ({
        id: skill.id,
        name: skill.name,
        description: skill.summary,
        icon: skill.icon,
        promptTemplate: skill.promptTemplate,
        outputMode: 'write' as const,
      }))
    const skills = [...getBuiltinSkills(), ...installedCommunity]
    const enabled = getEnabledSkills()
    return skills.map((s) => ({ ...s, enabled: enabled.includes(s.id) }))
  })

  ipcMain.handle('skills:toggle', async (_event, skillId: string, enabled: boolean) => {
    const result = toggleSkill(skillId, enabled)
    emitSkillsChanged(skillId, 'toggled')
    return result
  })

  ipcMain.handle('skills:getEnabled', async () => {
    return getEnabledSkills()
  })

  ipcMain.handle('skills:builtins', async () => {
    const enabled = getEnabledSkills()
    return getBuiltinSkills().map(skill => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      icon: skill.icon,
      enabled: enabled.includes(skill.id),
    }))
  })

  ipcMain.handle('skills:catalog', async () => {
    return getCommunityCatalog()
  })

  ipcMain.handle('skills:install', async (_event, skillId: string): Promise<CommunitySkillMutationResult> => {
    const skill = getCuratedCommunitySkill(skillId)
    if (!skill) return { success: false, error: '该 Skill 不在当前精选目录中' }
    if (getBuiltinSkills().some(item => item.id === skill.id)) {
      return { success: false, error: '该 Skill 与内置 Skill 重名，无法安装' }
    }
    try {
      await runSkillMutation(skill.id, async () => {
        await installCommunitySkill({ targetRoot: getAppSkillsDir(), skill })
        toggleSkill(skill.id, true)
      })
      emitSkillsChanged(skill.id, 'installed')
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '安装失败' }
    }
  })

  ipcMain.handle('skills:update', async (_event, skillId: string): Promise<CommunitySkillMutationResult> => {
    const skill = getCuratedCommunitySkill(skillId)
    if (!skill) return { success: false, error: '该 Skill 不在当前精选目录中' }
    try {
      const changed = await runSkillMutation(skill.id, async () => {
        if (sessionRuntime.isSkillActive(skill.id)) {
          throw new Error('该 Skill 正在执行，请等待任务结束后再更新')
        }
        const installation = await inspectCommunitySkillInstallation(getAppSkillsDir(), skill.id)
        if (!installation) throw new Error('该 Skill 尚未安装')
        if (installation.sourceRef === skill.source.ref) return false

        await installCommunitySkill({ targetRoot: getAppSkillsDir(), skill })
        toggleSkill(skill.id, true)
        return true
      })
      if (!changed) return { success: true }
      emitSkillsChanged(skill.id, 'updated')
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '更新失败' }
    }
  })

  ipcMain.handle('skills:uninstall', async (_event, skillId: string): Promise<CommunitySkillMutationResult> => {
    const skill = getCuratedCommunitySkill(skillId)
    if (!skill) return { success: false, error: '该 Skill 不在当前精选目录中' }
    try {
      await runSkillMutation(skill.id, async () => {
        if (sessionRuntime.isSkillActive(skill.id)) {
          throw new Error('该 Skill 正在执行，请等待任务结束后再卸载')
        }
        await uninstallCommunitySkill(getAppSkillsDir(), skill.id)
        toggleSkill(skill.id, false)
      })
      emitSkillsChanged(skill.id, 'uninstalled')
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '卸载失败' }
    }
  })
}
