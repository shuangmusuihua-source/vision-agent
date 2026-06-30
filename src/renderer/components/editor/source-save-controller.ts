export type SourceSaveHandler = (filePath: string, content: string) => void | Promise<unknown>

export class SourceSaveController {
  private dirty = false
  private timer: ReturnType<typeof setTimeout> | null = null
  private target: { filePath: string; content: string } | null = null
  private inFlightSaves = new Set<Promise<unknown>>()

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

  schedule(filePath: string, content: string): void {
    this.dirty = true
    this.target = { filePath, content }
    this.clearScheduledSave()
    this.timer = setTimeout(() => {
      this.flush()
    }, this.delayMs)
  }

  flush(): boolean {
    const target = this.takePendingTarget()
    if (!target) return false
    const save = this.trackSave(this.save(target.filePath, target.content))
    void save.catch(() => {})
    return true
  }

  async flushAsync(): Promise<boolean> {
    const target = this.takePendingTarget()
    const inFlight = Array.from(this.inFlightSaves)
    if (inFlight.length > 0) {
      const settled = await Promise.allSettled(inFlight)
      for (const outcome of settled) {
        if (outcome.status === 'rejected') throw outcome.reason
        this.assertSaveSucceeded(outcome.value)
      }
    }
    if (!target) return false
    const result = await this.trackSave(this.save(target.filePath, target.content))
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

  private takePendingTarget(): { filePath: string; content: string } | null {
    if (!this.hasPendingSave() || !this.target) return null
    const target = this.target
    this.clearScheduledSave()
    this.dirty = false
    this.target = null
    return target
  }

  private trackSave(result: void | Promise<unknown>): Promise<unknown> {
    const save = Promise.resolve(result)
    this.inFlightSaves.add(save)
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
