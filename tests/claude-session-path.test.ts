import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveClaudeSessionJsonlPath } from '../src/main/claude-session-path'

let tempRoot: string | null = null

function makeProjectsRoot(): string {
  tempRoot = mkdtempSync(join(tmpdir(), 'sumi-claude-projects-'))
  return tempRoot
}

afterEach(() => {
  if (tempRoot) rmSync(tempRoot, { recursive: true, force: true })
  tempRoot = null
})

describe('Claude session JSONL path resolution', () => {
  it('finds sessions when the SDK project directory uses a non-literal encoded name', () => {
    const root = makeProjectsRoot()
    const sessionId = 'sdk-session-product'
    const projectDir = join(root, '-Users-example-Documents-sumi------')
    mkdirSync(projectDir, { recursive: true })
    const jsonlPath = join(projectDir, `${sessionId}.jsonl`)
    writeFileSync(jsonlPath, '{}\n')

    expect(resolveClaudeSessionJsonlPath(sessionId, root)).toBe(jsonlPath)
  })

  it('finds app-scoped Ask sessions without a workspace path', () => {
    const root = makeProjectsRoot()
    const sessionId = 'sdk-session-ask'
    const projectDir = join(root, '-Users-example-Library-Application-Support-sumi')
    mkdirSync(projectDir, { recursive: true })
    const jsonlPath = join(projectDir, `${sessionId}.jsonl`)
    writeFileSync(jsonlPath, '{}\n')

    expect(resolveClaudeSessionJsonlPath(sessionId, root)).toBe(jsonlPath)
  })
})
