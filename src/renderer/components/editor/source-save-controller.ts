export type SourceSaveHandler = (filePath: string, content: string) => void | Promise<unknown>

type SaveTarget = { filePath: string; content: string; save: SourceSaveHandler }
// Also order saves captured by an editor that is unmounting against saves
// from its replacement. Entries disappear as soon as their writes settle.
const fileSaves = new Map<string, Promise<unknown>>()

export class SourceSaveController {
  private dirty = false
  private timer: ReturnType<typeof setTimeout> | null = null
  private target: SaveTarget | null = null
  private inFlightSaves = new Map<Promise<unknown>, string>()

  constructor(
    private save: SourceSaveHandler,
    private readonly delayMs = 1500
  ) {}

  setSaveHandler(save: SourceSaveHandler): void {
    this.save = save
  }

  hasPendingSave(): boolean {
    return this.dirty && this.target !== null
  }

  hasUnsettledSave(filePath: string): boolean {
    return (this.hasPendingSave() && this.target?.filePath === filePath)
      || [...this.inFlightSaves.values()].includes(filePath)
  }

  schedule(filePath: string, content: string): void {
    this.dirty = true
    // Capture the owner-specific save handler with the edit. React may switch
    // workspace/session props before this debounce flushes; using the latest
    // handler would project the old document's result into the new owner.
    this.target = { filePath, content, save: this.save }
    this.clearScheduledSave()
    this.timer = setTimeout(() => {
      this.flush()
    }, this.delayMs)
  }

  flush(): boolean {
    const target = this.takePendingTarget()
    if (!target) return false
    const save = this.submit(target)
    void save.catch(() => {})
    return true
  }

  async flushAsync(): Promise<boolean> {
    // Keep the latest draft pending while an older save can still fail. Taking
    // it here would lose an unsubmitted edit on the error path below.
    this.clearScheduledSave()
    while (this.inFlightSaves.size > 0) {
      const settled = await Promise.allSettled(Array.from(this.inFlightSaves.keys()))
      for (const outcome of settled) {
        if (outcome.status === 'rejected') throw outcome.reason
        this.assertSaveSucceeded(outcome.value)
      }
    }
    const target = this.takePendingTarget()
    if (!target) return false
    const result = await this.submit(target)
    this.assertSaveSucceeded(result)
    return true
  }

  discard(): void {
    this.clearScheduledSave()
    this.dirty = false
    this.target = null
  }

  clearScheduledSave(): void {
    if (!this.timer) return
    clearTimeout(this.timer)
    this.timer = null
  }

  private takePendingTarget(): SaveTarget | null {
    if (!this.hasPendingSave() || !this.target) return null
    const target = this.target
    this.clearScheduledSave()
    this.dirty = false
    this.target = null
    return target
  }

  private submit(target: SaveTarget): Promise<unknown> {
    const previous = new Set(this.inFlightSaves.keys())
    const fileSave = fileSaves.get(target.filePath)
    if (fileSave) previous.add(fileSave)
    let result: void | Promise<unknown>
    try {
      result = previous.size > 0
        ? Promise.allSettled([...previous]).then(() => target.save(target.filePath, target.content))
        : target.save(target.filePath, target.content)
    } catch (error) {
      result = Promise.reject(error)
    }
    const save = this.trackSave(result, target.filePath)
    if (result !== undefined) {
      fileSaves.set(target.filePath, save)
      const cleanup = () => {
        if (fileSaves.get(target.filePath) === save) fileSaves.delete(target.filePath)
      }
      void save.then(cleanup, cleanup)
    }
    return save
  }

  private trackSave(result: void | Promise<unknown>, filePath: string): Promise<unknown> {
    const save = Promise.resolve(result)
    if (result === undefined) return save
    this.inFlightSaves.set(save, filePath)
    void save.then(
      () => this.inFlightSaves.delete(save),
      () => this.inFlightSaves.delete(save),
    )
    return save
  }

  private assertSaveSucceeded(result: unknown): void {
    if (!result || typeof result !== 'object' || !('success' in result) || result.success !== false) return
    const message = 'error' in result && typeof result.error === 'string' ? result.error : '保存失败'
    throw new Error(message)
  }
}
