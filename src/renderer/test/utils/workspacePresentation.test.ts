import { describe, expect, it } from 'vitest'
import { EMPTY_WORKSPACE_RUNTIME, type WorkspaceDescriptor } from '../../src/stores/workspaceStore'
import { createWorkspacePresentation, getWorkspaceDisplayLabel, hasMeaningfulWorkspaceState, hasOwnedDraft } from '../../src/utils/workspacePresentation'
import type { EditSession } from '../../src/stores/editSessionStore'

const workspace = (overrides: Partial<WorkspaceDescriptor> = {}): WorkspaceDescriptor => ({
  id: 'workspace-a',
  name: '未命名工作区',
  primaryRoot: null,
  lifecycleEpoch: 1,
  ...overrides,
})

describe('workspacePresentation', () => {
  it('按显式名称、根目录、标签和空白依次回退', () => {
    expect(getWorkspaceDisplayLabel(workspace({ name: '阅读会话' }))).toBe('阅读会话')
    expect(getWorkspaceDisplayLabel(workspace({ primaryRoot: '/docs/videos' }))).toBe('videos')
    expect(getWorkspaceDisplayLabel(workspace(), [{ id: 'tab-1', file: { name: 'draft.md', path: '/draft.md', isDirectory: false }, content: '' }])).toBe('draft.md')
    expect(getWorkspaceDisplayLabel(workspace())).toBe('空白会话')
  })

  it('只把无根、无标签、无布局和无草稿的会话视为空占位', () => {
    expect(createWorkspacePresentation(workspace(), EMPTY_WORKSPACE_RUNTIME, false).isEmptyPlaceholder).toBe(true)
    const withTab = {
      ...EMPTY_WORKSPACE_RUNTIME,
      tabs: [{ id: 'tab-1', file: { name: 'draft.md', path: '/draft.md', isDirectory: false }, content: '' }],
      activeTabId: 'tab-1',
    }
    expect(createWorkspacePresentation(workspace(), withTab, false)).toMatchObject({
      label: 'draft.md',
      tabCount: 1,
      activeTabName: 'draft.md',
      isEmptyPlaceholder: false,
    })
    expect(createWorkspacePresentation(workspace(), EMPTY_WORKSPACE_RUNTIME, true).isEmptyPlaceholder).toBe(false)
  })

  it('区分目录上下文与有意义的会话状态', () => {
    const rooted = workspace({ primaryRoot: '/docs/videos' })
    expect(createWorkspacePresentation(rooted, EMPTY_WORKSPACE_RUNTIME, false)).toMatchObject({
      isEmptyPlaceholder: false,
      hasMeaningfulState: false,
    })
    expect(hasMeaningfulWorkspaceState({ ...EMPTY_WORKSPACE_RUNTIME, files: [{ name: 'a.md', path: '/docs/videos/a.md', isDirectory: false }] }, false)).toBe(false)

    const withTab = {
      ...EMPTY_WORKSPACE_RUNTIME,
      tabs: [{ id: 'tab-1', file: { name: 'a.md', path: '/docs/videos/a.md', isDirectory: false }, content: '' }],
      activeTabId: 'tab-1',
    }
    expect(hasMeaningfulWorkspaceState(withTab, false)).toBe(true)
    expect(hasMeaningfulWorkspaceState({ ...withTab, documentViews: { 'single:tab-1': { mode: 'edit', compareRatio: 0.5, target: null } } }, false)).toBe(true)
    expect(hasMeaningfulWorkspaceState({ ...EMPTY_WORKSPACE_RUNTIME, documentViews: { 'single:missing': { mode: 'edit', compareRatio: 0.5, target: null } } }, false)).toBe(false)
  })

  it('按 workspace identity 保护独立草稿', () => {
    const descriptor = workspace({ primaryRoot: '/docs/videos', lifecycleEpoch: 2 })
    const draft = {
      canonicalPath: '/docs/videos/draft.md', workspaceId: descriptor.id, lifecycleEpoch: 2,
      displayPath: '/docs/videos/draft.md', fileName: 'draft.md', status: 'dirty', original: '', draft: 'x',
      draftVersion: 1, writerId: null, dirty: true, saving: false, error: null,
      baseRevisionToken: 'a', lastKnownDiskRevisionToken: 'a', conflictReason: null, undoStack: [], redoStack: [],
    } satisfies EditSession
    expect(hasOwnedDraft(descriptor, { [draft.canonicalPath]: draft })).toBe(true)
    expect(hasOwnedDraft({ ...descriptor, lifecycleEpoch: 3 }, { [draft.canonicalPath]: draft })).toBe(false)
  })
})
