import { randomUUID } from 'crypto'
import type { CurationDraft } from '../shared/curation-types'

type Scope = { sessionId?: string; workspacePath?: string }

/** Ownership and cancellation of short-lived, tool-free preparation runs. */
export class CurationJobs {
  private runs = new Map<string, { owner: number; scope: Scope; controller: AbortController; done: Promise<unknown> }>()

  async run<T>(owner: number, requestId: string, scope: Scope, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (!/^[\w-]{1,128}$/.test(requestId) || this.runs.has(requestId)) throw new Error('整理请求标识无效或已在运行')
    if (this.runs.size >= 4) throw new Error('已有多个整理任务，请稍后重试')
    const controller = new AbortController()
    const done = Promise.resolve().then(() => operation(controller.signal)).then(value => {
      controller.signal.throwIfAborted()
      return value
    })
    this.runs.set(requestId, { owner, scope, controller, done })
    try { return await done } finally { this.runs.delete(requestId) }
  }

  cancel(owner: number, requestId: string): void {
    const run = this.runs.get(requestId)
    if (run?.owner === owner) run.controller.abort()
  }

  async cancelScope(scope: Scope): Promise<void> {
    const runs = [...this.runs.values()].filter(run => (
      (scope.sessionId && run.scope.sessionId === scope.sessionId)
      || (scope.workspacePath && run.scope.workspacePath === scope.workspacePath)
    ))
    runs.forEach(run => run.controller.abort())
    await Promise.allSettled(runs.map(run => run.done))
  }

  cancelAll(owner?: number): void {
    for (const run of this.runs.values()) if (owner === undefined || run.owner === owner) run.controller.abort()
  }
}

export class CurationDrafts<T> {
  private drafts = new Map<string, { owner: number; expires: number; value: T; publicDraft: CurationDraft }>()

  add(owner: number, publicDraft: Omit<CurationDraft, 'id'>, value: T): CurationDraft {
    for (const [id, draft] of this.drafts) if (draft.expires <= Date.now()) this.drafts.delete(id)
    if (this.drafts.size >= 32) throw new Error('待保存草稿过多，请先关闭旧草稿')
    const result = { ...publicDraft, id: randomUUID() }
    this.drafts.set(result.id, { owner, expires: Date.now() + 30 * 60_000, value, publicDraft: result })
    return result
  }

  get(owner: number, id: string): { value: T; publicDraft: CurationDraft } {
    const draft = this.drafts.get(id)
    if (!draft || draft.owner !== owner || draft.expires <= Date.now()) throw new Error('草稿已过期，请重新生成')
    return draft
  }

  discard(owner: number, id: string): void {
    if (this.drafts.get(id)?.owner === owner) this.drafts.delete(id)
  }

  discardOwner(owner: number): void {
    for (const [id, draft] of this.drafts) if (draft.owner === owner) this.drafts.delete(id)
  }
}
