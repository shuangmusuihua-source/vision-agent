const activeMutations = new Map<string, Promise<unknown>>()

export async function runSkillMutation<T>(skillId: string, mutation: () => Promise<T>): Promise<T> {
  if (activeMutations.has(skillId)) {
    throw new Error('该 Skill 正在进行其他操作，请稍后重试')
  }

  const pending = mutation()
  activeMutations.set(skillId, pending)
  try {
    return await pending
  } finally {
    if (activeMutations.get(skillId) === pending) activeMutations.delete(skillId)
  }
}
