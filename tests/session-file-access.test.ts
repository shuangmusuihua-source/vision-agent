import { describe, expect, it } from 'vitest'
import { decideSessionFileAccess, extractExplicitAbsolutePaths } from '../src/main/session-file-access'

const workingDirectory = '/workspace/.sumi/sessions/current'
const skillsDirectory = '/app/.claude/skills'

function decide(
  toolName: string,
  input: Record<string, unknown>,
  explicitExternalPaths: string[] = [],
  authorizedExternalReadPaths: string[] = [],
) {
  return decideSessionFileAccess({
    toolName,
    input,
    workingDirectory,
    skillsDirectory,
    authorizedExternalReadPaths,
    explicitExternalPaths,
  })
}

describe('session file access', () => {
  it('allows reads and writes owned by the current session', () => {
    expect(decide('Read', { file_path: 'notes.md' })).toBe('allow')
    expect(decide('Glob', { path: '.', pattern: '**/*' })).toBe('allow')
    expect(decide('Write', { file_path: 'deliverables/report.md' })).toBe('allow')
  })

  it('allows reading skills without allowing them to be modified', () => {
    const skillPath = '/app/.claude/skills/frontend-design/SKILL.md'
    expect(decide('Read', { file_path: skillPath })).toBe('allow')
    expect(decide('Write', { file_path: skillPath })).toBe('deny')
  })

  it('never allows the agent to write SDK project configuration', () => {
    expect(decide('Write', { file_path: '.claude/settings.json' })).toBe('deny')
    expect(decide('Edit', { file_path: 'CLAUDE.md' })).toBe('deny')
    expect(decide('Write', { file_path: '.mcp.json' })).toBe('deny')
  })

  it('rejects guessed paths and prompts only for paths supplied by the user', () => {
    const externalFile = '/workspace/other-session/report.md'
    expect(decide('Read', { file_path: externalFile })).toBe('deny')
    expect(decide('Read', { file_path: externalFile }, [externalFile])).toBe('prompt')
    expect(decide('Glob', { path: '/workspace', pattern: '**/*' })).toBe('deny')
    expect(decide('Bash', { command: 'ls -la /workspace' })).toBe('prompt')
  })

  it('treats a file-picker attachment grant as read-only authorization for this turn', () => {
    const selectedFile = '/Users/me/Documents/research notes.md'
    expect(decide('Read', { file_path: selectedFile }, [], [selectedFile])).toBe('allow')
    expect(decide('Write', { file_path: selectedFile }, [], [selectedFile])).toBe('deny')
    expect(decide('Read', { file_path: '/Users/me/Documents/other.md' }, [], [selectedFile])).toBe('deny')
  })

  it('extracts absolute paths explicitly included in the user message', () => {
    expect(extractExplicitAbsolutePaths(
      '请读取 /Users/me/Documents/session-a/report.md，然后总结。',
    )).toEqual(['/Users/me/Documents/session-a/report.md'])
    expect(extractExplicitAbsolutePaths(
      '请读取 "/Applications/Research Data/report.md" 然后总结',
    )).toEqual(['/Applications/Research Data/report.md'])
  })
})
