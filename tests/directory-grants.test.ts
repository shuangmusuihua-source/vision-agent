import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { consumeSelectedDirectoryGrant, rememberSelectedDirectoryGrant } from '../src/main/directory-grants'

describe('directory selection grants', () => {
  it('consumes a selected directory exactly once', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sumi-directory-grant-'))
    rememberSelectedDirectoryGrant(dir, 100)

    expect(consumeSelectedDirectoryGrant(dir, 101)).toBe(true)
    expect(consumeSelectedDirectoryGrant(dir, 102)).toBe(false)
  })

  it('rejects expired and nonexistent paths', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sumi-directory-grant-'))
    rememberSelectedDirectoryGrant(dir, 100)

    expect(consumeSelectedDirectoryGrant(dir, 10 * 60 * 1000 + 101)).toBe(false)
    expect(consumeSelectedDirectoryGrant(join(dir, 'missing'))).toBe(false)
  })
})
