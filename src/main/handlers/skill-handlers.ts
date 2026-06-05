import { ipcMain } from 'electron'
import { getEnabledSkills, toggleSkill } from '../store'
import { getBuiltinSkills } from '../skills/builtin'

export function registerSkillHandlers(): void {
  ipcMain.handle('skills:list', async () => {
    const skills = getBuiltinSkills()
    const enabled = getEnabledSkills()
    return skills.map((s) => ({ ...s, enabled: enabled.includes(s.id) }))
  })

  ipcMain.handle('skills:toggle', async (_event, skillId: string, enabled: boolean) => {
    return toggleSkill(skillId, enabled)
  })

  ipcMain.handle('skills:getEnabled', async () => {
    return getEnabledSkills()
  })
}
