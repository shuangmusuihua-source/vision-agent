import { describe, expect, it } from 'vitest'
import { runSkillMutation } from '../src/main/skill-mutation-coordinator'

describe('Skill mutation coordinator', () => {
  it('rejects overlapping mutations for the same Skill', async () => {
    let release!: () => void
    const first = runSkillMutation('frontend-design', () => new Promise<void>((resolve) => {
      release = resolve
    }))

    await expect(runSkillMutation('frontend-design', async () => undefined))
      .rejects.toThrow('正在进行其他操作')

    release()
    await first
  })

  it('allows different Skills to mutate independently', async () => {
    await expect(Promise.all([
      runSkillMutation('one', async () => 'one'),
      runSkillMutation('two', async () => 'two'),
    ])).resolves.toEqual(['one', 'two'])
  })
})
