export class EditorProjectionScheduler<T> {
  private timer: ReturnType<typeof setTimeout> | null = null
  private pending = false
  private latestValue: T | null = null

  constructor(
    private readonly project: (value: T) => void,
    private readonly intervalMs = 120,
  ) {}

  schedule(value: T): void {
    this.pending = true
    this.latestValue = value
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      this.flush()
    }, this.intervalMs)
  }

  flush(): boolean {
    if (!this.pending || this.latestValue === null) return false
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    const value = this.latestValue
    this.pending = false
    this.latestValue = null
    this.project(value)
    return true
  }

  discard(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.pending = false
    this.latestValue = null
  }
}
