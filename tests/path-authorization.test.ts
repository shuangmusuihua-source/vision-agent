import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { describe, expect, it } from 'vitest'
import { extractToolPathInput, isPathAuthorized, toolRequiresPath } from '../src/main/agent-path-utils'

function makeTempWorkspace() {
  const root = mkdtempSync(path.join(tmpdir(), 'sumi-auth-'))
  const workspace = path.join(root, 'workspace')
  const outside = path.join(root, 'outside')
  mkdirSync(workspace)
  mkdirSync(outside)
  return { root, workspace, outside }
}

describe('agent path authorization', () => {
  it('resolves relative paths against the provided cwd', () => {
    const { workspace, outside } = makeTempWorkspace()
    writeFileSync(path.join(workspace, 'note.md'), 'inside')
    writeFileSync(path.join(outside, 'secret.md'), 'outside')

    expect(isPathAuthorized('note.md', [workspace], { cwd: workspace })).toBe(true)
    expect(isPathAuthorized('../outside/secret.md', [workspace], { cwd: workspace })).toBe(false)
  })

  it('rejects paths that escape an authorized root through a symlink', () => {
    const { workspace, outside } = makeTempWorkspace()
    writeFileSync(path.join(outside, 'secret.md'), 'outside')
    symlinkSync(outside, path.join(workspace, 'linked-outside'), 'dir')

    expect(isPathAuthorized('linked-outside/secret.md', [workspace], { cwd: workspace })).toBe(false)
    expect(isPathAuthorized('linked-outside/new-file.md', [workspace], { cwd: workspace })).toBe(false)
  })

  it('extracts SDK tool path fields consistently', () => {
    expect(extractToolPathInput('Write', { file_path: 'note.md' })).toBe('note.md')
    expect(extractToolPathInput('Grep', { path: 'docs' })).toBe('docs')
    expect(extractToolPathInput('Glob', { path: 'src' })).toBe('src')
    expect(extractToolPathInput('Bash', { command: 'cat note.md' })).toBeNull()
  })

  it('requires explicit paths only for file tools', () => {
    expect(toolRequiresPath('Read')).toBe(true)
    expect(toolRequiresPath('Write')).toBe(true)
    expect(toolRequiresPath('Edit')).toBe(true)
    expect(toolRequiresPath('Glob')).toBe(false)
    expect(toolRequiresPath('Grep')).toBe(false)
  })
})
