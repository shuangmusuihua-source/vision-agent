import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useGraphStore } from '../src/renderer/store/graph-store'
import { useUiStore } from '../src/renderer/store/ui-slice'

const graphData = {
  nodes: [
    { id: '/knowledge/note.md', label: 'note.md', type: 'file' as const },
    { id: 'entity:Research', label: 'Research', type: 'entity' as const },
  ],
  edges: [
    { source: '/knowledge/note.md', target: 'entity:Research', type: 'reference' as const },
  ],
  changeVersion: 4,
}

const getData = vi.fn()
const acknowledgeChanges = vi.fn()

beforeEach(() => {
  getData.mockReset()
  acknowledgeChanges.mockReset()
  vi.stubGlobal('window', {
    api: {
      graph: { getData, acknowledgeChanges },
    },
  })
  useUiStore.setState({ view: 'ask' })
  useGraphStore.setState({
    graphData: { nodes: [], edges: [] },
    changedFileCount: 0,
    changedFiles: [],
    changedFileVersion: 0,
    isLoading: false,
    error: null,
  })
})

describe('knowledge module', () => {
  it('is a first-class primary view', () => {
    useUiStore.getState().setView('knowledge')
    expect(useUiStore.getState().view).toBe('knowledge')
  })

  it('loads graph data and acknowledges the loaded version', async () => {
    getData.mockResolvedValue(graphData)
    acknowledgeChanges.mockResolvedValue({ count: 0, files: [], version: 4 })
    useGraphStore.setState({ changedFileCount: 2, changedFiles: ['/knowledge/note.md'] })

    await useGraphStore.getState().loadGraphData()

    expect(getData).toHaveBeenCalledOnce()
    expect(acknowledgeChanges).toHaveBeenCalledWith(4)
    expect(useGraphStore.getState()).toMatchObject({
      graphData,
      changedFileCount: 0,
      changedFiles: [],
      changedFileVersion: 4,
      isLoading: false,
      error: null,
    })
  })

  it('exposes a recoverable loading error', async () => {
    getData.mockRejectedValue(new Error('index unavailable'))

    await useGraphStore.getState().loadGraphData()

    expect(useGraphStore.getState()).toMatchObject({
      isLoading: false,
      error: 'index unavailable',
    })
  })
})
