export type SourceSaveHandler = (filePath: string, content: string) => void | Promise<unknown>

export class SourceSaveController {
  private dirty = false
  private timer: ReturnType<typeof setTimeout> | null = null
  private target: { filePath: string; content: string } | null = null

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
    if (!this.hasPendingSave() || !this.target) return false
    const target = this.target
    this.clearScheduledSave()
    this.save(target.filePath, target.content)
    this.dirty = false
    this.target = null
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
}
