import { mkdtemp, rm, symlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  consumeAttachmentPathGrant,
  createAttachmentPathGrant,
} from '../src/main/attachment-path-authorization'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('attachment path authorization', () => {
  it('authorizes only files explicitly selected by the user', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sumi-attachment-auth-'))
    temporaryDirectories.push(root)
    const selected = join(root, 'selected.pdf')
    const sibling = join(root, 'sibling.pdf')
    await writeFile(selected, 'selected')
    await writeFile(sibling, 'sibling')

    const grantId = createAttachmentPathGrant([selected])

    expect(consumeAttachmentPathGrant(grantId, sibling)).toBe(false)
    expect(consumeAttachmentPathGrant(grantId, selected)).toBe(true)
    expect(consumeAttachmentPathGrant(grantId, selected)).toBe(false)
  })

  it('canonicalizes symlinks before comparing paths', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sumi-attachment-auth-'))
    temporaryDirectories.push(root)
    const selected = join(root, 'selected.pdf')
    const alias = join(root, 'alias.pdf')
    await writeFile(selected, 'selected')
    await symlink(selected, alias)

    const grantId = createAttachmentPathGrant([selected])

    expect(consumeAttachmentPathGrant(grantId, alias)).toBe(true)
  })
})
