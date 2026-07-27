import { randomUUID } from 'crypto'
import { mkdir, rename, rm } from 'fs/promises'
import { basename, dirname, join } from 'path'

export type ManagedRuntimeInstallPreflight<Result, Context> =
  | { install: false; result: Result }
  | { install: true; context: Context }

export interface ManagedRuntimeInstallAdapter<Result, Context> {
  preflight(): Promise<ManagedRuntimeInstallPreflight<Result, Context>>
  stage(stagingPath: string, context: Context): Promise<void>
  activate(targetPath: string, context: Context): Promise<Result>
  failure(error: unknown): Result | Promise<Result>
}

export class ManagedRuntimeInstallTransaction<Result> {
  private inFlight: Promise<Result> | null = null

  constructor(
    private readonly targetPath: string,
    private readonly nonce: () => string = randomUUID,
  ) {}

  run<Context>(adapter: ManagedRuntimeInstallAdapter<Result, Context>): Promise<Result> {
    if (!this.inFlight) {
      this.inFlight = this.execute(adapter).finally(() => {
        this.inFlight = null
      })
    }
    return this.inFlight
  }

  private async execute<Context>(
    adapter: ManagedRuntimeInstallAdapter<Result, Context>,
  ): Promise<Result> {
    const preflight = await adapter.preflight()
    if (!preflight.install) return preflight.result

    const parentPath = dirname(this.targetPath)
    const targetName = basename(this.targetPath)
    const nonce = this.nonce()
    const stagingPath = join(parentPath, `.${targetName}.install-${nonce}`)
    const backupPath = join(parentPath, `.${targetName}.backup-${nonce}`)
    let targetBackedUp = false
    let stagingActivated = false
    let preserveBackup = false

    await mkdir(parentPath, { recursive: true })
    try {
      await adapter.stage(stagingPath, preflight.context)

      try {
        await rename(this.targetPath, backupPath)
        targetBackedUp = true
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }

      await rename(stagingPath, this.targetPath)
      stagingActivated = true
      const result = await adapter.activate(this.targetPath, preflight.context)
      if (targetBackedUp) {
        await rm(backupPath, { recursive: true, force: true })
        targetBackedUp = false
      }
      return result
    } catch (error) {
      let failure = error
      try {
        if (stagingActivated) {
          await rm(this.targetPath, { recursive: true, force: true })
          stagingActivated = false
        }
        if (targetBackedUp) {
          await rename(backupPath, this.targetPath)
          targetBackedUp = false
        }
      } catch (rollbackError) {
        preserveBackup = targetBackedUp
        failure = new AggregateError(
          [error, rollbackError],
          `Managed runtime install failed and rollback could not restore ${this.targetPath}`,
        )
      }
      return adapter.failure(failure)
    } finally {
      await rm(stagingPath, { recursive: true, force: true }).catch(() => undefined)
      if (!preserveBackup) {
        await rm(backupPath, { recursive: true, force: true }).catch(() => undefined)
      }
    }
  }
}
