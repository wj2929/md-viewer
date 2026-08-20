import { beforeEach, describe, expect, it } from 'vitest'
import { useWorkspaceStore, type WorkspaceRuntimeSnapshot } from '../../src/stores/workspaceStore'

const runtime = (): WorkspaceRuntimeSnapshot => ({
  folderPath: '/workspace-a',
  files: [{ name: 'a.md', path: '/workspace-a/a.md', isDirectory: false }],
  selectedPaths: new Set(['/workspace-a/a.md']),
  tabs: [{
    id: 'tab-a',
    file: { name: 'a.md', path: '/workspace-a/a.md', isDirectory: false },
    content: '# A',
  }],
  activeTabId: 'tab-a',
  splitState: {
    root: {
      type: 'split',
      id: 'split-a',
      direction: 'horizontal',
      ratio: 0.5,
      first: { type: 'leaf', id: 'leaf-a', tabId: 'tab-a' },
      second: { type: 'leaf', id: 'leaf-b', tabId: 'tab-b' },
    },
    activeLeafId: 'leaf-a',
  },
  scrollToLine: undefined,
  scrollToRatio: undefined,
  highlightKeyword: undefined,
  documentViews: {
    'leaf-a:tab-a': {
      mode: 'compare',
      compareRatio: 0.6,
      target: { filePath: '/workspace-a/a.md', tabId: 'tab-a', mode: 'document' },
    },
  },
  quickEditPlacements: {
    'tab-a': { filePath: '/workspace-a/a.md', tabId: 'tab-a', mode: 'source-line', sourceLine: 8 },
  },
})

describe('workspaceStore runtime isolation', () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ workspaces: [], activeWorkspaceId: null, runtimes: {} })
  })

  it('deeply isolates nested runtime state from subsequent caller mutations', () => {
    const source = runtime()
    useWorkspaceStore.getState().saveRuntime('workspace-a', source)

    source.files[0].name = 'mutated.md'
    if (!source.splitState.root || source.splitState.root.type !== 'split') {
      throw new Error('Test runtime must start with a split root')
    }
    source.splitState.root.first = { type: 'leaf', id: 'mutated-leaf', tabId: 'mutated-tab' }
    source.documentViews['leaf-a:tab-a'].target!.filePath = '/mutated.md'
    source.quickEditPlacements['tab-a'].sourceLine = 99

    const stored = useWorkspaceStore.getState().getRuntime('workspace-a')
    expect(stored.files[0].name).toBe('a.md')
    expect(stored.splitState.root).toMatchObject({
      type: 'split',
      first: { id: 'leaf-a', tabId: 'tab-a' },
    })
    expect(stored.documentViews['leaf-a:tab-a'].target?.filePath).toBe('/workspace-a/a.md')
    expect(stored.quickEditPlacements['tab-a'].sourceLine).toBe(8)
  })

  it('returns an isolated copy instead of exposing persisted nested state', () => {
    useWorkspaceStore.getState().saveRuntime('workspace-a', runtime())

    const returned = useWorkspaceStore.getState().getRuntime('workspace-a')
    if (!returned.splitState.root || returned.splitState.root.type !== 'split') {
      throw new Error('Stored runtime must have a split root')
    }
    returned.splitState.root.first = { type: 'leaf', id: 'changed-leaf', tabId: 'changed-tab' }
    returned.documentViews['leaf-a:tab-a'].mode = 'edit'
    returned.quickEditPlacements['tab-a'].sourceLine = 99

    const persisted = useWorkspaceStore.getState().getRuntime('workspace-a')
    expect(persisted.splitState.root).toMatchObject({
      type: 'split',
      first: { id: 'leaf-a', tabId: 'tab-a' },
    })
    expect(persisted.documentViews['leaf-a:tab-a'].mode).toBe('compare')
    expect(persisted.quickEditPlacements['tab-a'].sourceLine).toBe(8)
  })

  it('原子清理多个非活动 workspace 及其 runtime', () => {
    const descriptors = [
      { id: 'workspace-a', name: 'A', primaryRoot: '/workspace-a', lifecycleEpoch: 1 },
      { id: 'workspace-b', name: 'B', primaryRoot: '/workspace-b', lifecycleEpoch: 1 },
      { id: 'workspace-c', name: 'C', primaryRoot: '/workspace-c', lifecycleEpoch: 1 },
    ]
    useWorkspaceStore.getState().setWorkspaces(descriptors, 'workspace-a')
    useWorkspaceStore.getState().saveRuntime('workspace-b', runtime())
    useWorkspaceStore.getState().saveRuntime('workspace-c', runtime())

    useWorkspaceStore.getState().removeWorkspaces(['workspace-b', 'workspace-c'])
    expect(useWorkspaceStore.getState()).toMatchObject({
      workspaces: [descriptors[0]],
      activeWorkspaceId: 'workspace-a',
      runtimes: { 'workspace-a': expect.any(Object) },
    })
  })

  it('删除集合包含 active 时不产生部分清理', () => {
    const descriptors = [
      { id: 'workspace-a', name: 'A', primaryRoot: '/workspace-a', lifecycleEpoch: 1 },
      { id: 'workspace-b', name: 'B', primaryRoot: '/workspace-b', lifecycleEpoch: 1 },
    ]
    useWorkspaceStore.getState().setWorkspaces(descriptors, 'workspace-a')
    useWorkspaceStore.getState().removeWorkspaces(['workspace-a', 'workspace-b'])
    expect(useWorkspaceStore.getState().workspaces).toEqual(descriptors)
  })
})
