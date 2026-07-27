import { afterEach, describe, expect, it } from 'vitest'
import { useUiStore } from '../src/renderer/store/ui-slice'

describe('UI search state', () => {
  afterEach(() => {
    useUiStore.getState().closeSearch()
  })

  it('opens with an optional initial query', () => {
    useUiStore.getState().openSearch('session notes')

    expect(useUiStore.getState()).toMatchObject({
      showSearch: true,
      searchQuery: 'session notes',
    })
  })

  it('ignores accidental non-string arguments from event callbacks', () => {
    const openSearch = useUiStore.getState().openSearch as (query?: unknown) => void
    openSearch({ type: 'click' })

    expect(useUiStore.getState()).toMatchObject({
      showSearch: true,
      searchQuery: '',
    })
  })
})
