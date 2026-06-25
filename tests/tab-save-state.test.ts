import { describe, expect, it } from 'vitest'
import {
  createWorkspaceTabState,
  pendingSaveFor,
  visibleFileContent,
  withPendingSave,
  withSavedFile,
  withoutFilePrefixState,
  withoutFileState,
} from '../src/renderer/hooks/tab-save-state'

describe('tab save state', () => {
  it('keeps failed save content visible without marking it saved', () => {
    const initial = {
      ...createWorkspaceTabState(),
      tabs: [{ type: 'file' as const, path: '/workspace/a.md' }],
      activeTab: { type: 'file' as const, path: '/workspace/a.md' },
      tabContents: { '/workspace/a.md': 'last saved' },
    }

    const failed = withPendingSave(initial, '/workspace/a.md', 'unsaved draft', 'permission denied')

    expect(visibleFileContent(failed, '/workspace/a.md')).toBe('unsaved draft')
    expect(failed.tabContents['/workspace/a.md']).toBe('last saved')
    expect(pendingSaveFor(failed, '/workspace/a.md')).toEqual({
      content: 'unsaved draft',
      error: 'permission denied',
    })
  })

  it('clears pending save state when a retry succeeds', () => {
    const failed = withPendingSave(
      { ...createWorkspaceTabState(), tabContents: { '/workspace/a.md': 'last saved' } },
      '/workspace/a.md',
      'retry draft',
      'disk full'
    )

    const saved = withSavedFile(failed, '/workspace/a.md', 'retry draft')

    expect(visibleFileContent(saved, '/workspace/a.md')).toBe('retry draft')
    expect(pendingSaveFor(saved, '/workspace/a.md')).toBeNull()
  })

  it('removes pending save state when closing a file or folder prefix', () => {
    const state = withPendingSave(
      {
        ...createWorkspaceTabState(),
        tabContents: {
          '/workspace/a.md': 'a',
          '/workspace/folder/b.md': 'b',
        },
      },
      '/workspace/folder/b.md',
      'pending b',
      'failed'
    )

    const withoutFile = withoutFileState(state, '/workspace/folder/b.md')
    expect(withoutFile.tabContents['/workspace/folder/b.md']).toBeUndefined()
    expect(pendingSaveFor(withoutFile, '/workspace/folder/b.md')).toBeNull()

    const withPendingAgain = withPendingSave(state, '/workspace/folder/c.md', 'pending c', 'failed')
    const withoutPrefix = withoutFilePrefixState(withPendingAgain, '/workspace/folder')
    expect(withoutPrefix.tabContents['/workspace/a.md']).toBe('a')
    expect(withoutPrefix.tabContents['/workspace/folder/b.md']).toBeUndefined()
    expect(pendingSaveFor(withoutPrefix, '/workspace/folder/b.md')).toBeNull()
    expect(pendingSaveFor(withoutPrefix, '/workspace/folder/c.md')).toBeNull()
  })
})
