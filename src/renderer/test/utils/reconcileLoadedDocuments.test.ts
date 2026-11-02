import { beforeEach, describe, expect, it, vi } from 'vitest'
import { reconcileLoadedDocuments } from '../../src/utils/reconcileLoadedDocuments'
import { useTabStore, useEditSessionStore, useWorkspaceStore } from '../../src/stores'

const io = vi.hoisted(() => ({ read: vi.fn() }))
vi.mock('../../src/utils/fileCache', () => ({ readPreviewContentWithCache: io.read, clearFileCache: vi.fn() }))
vi.mock('../../src/utils/ensureTabContentLoaded', () => ({ invalidateTabContentLoad: vi.fn() }))
const file = '/ws/a.md'
function openSession() {
  useEditSessionStore.getState().openSession({
    canonicalPath: file, displayPath: file, fileName: 'a.md', content: '# old',
    mtimeMs: 1, revisionToken: 'old', workspaceId: 'a', lifecycleEpoch: 1,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  useWorkspaceStore.setState({ activeWorkspaceId: 'a', workspaces: [{ id: 'a', primaryRoot: '/ws', lifecycleEpoch: 1 }] as any })
  useEditSessionStore.getState().reset()
  useTabStore.setState({ tabs: [
    { id: 'loaded', file: { path: file, name: 'a.md', isDirectory: false }, content: '# old', isPinned: false },
    { id: 'shell', file: { path: '/ws/b.md', name: 'b.md', isDirectory: false }, content: null, isPinned: false },
  ] })
  io.read.mockResolvedValue('# new')
  Object.defineProperty(window, 'api', { configurable: true, writable: true, value: {} })
  window.api.openEditableMarkdown = vi.fn().mockResolvedValue({ content: '# new', revisionToken: 'new' })
  window.api.fileExists = vi.fn().mockResolvedValue(true)
})

describe('watch reconciliation document safety', () => {
  it('refreshes only loaded tabs and invalidates media revisions', async () => {
    await reconcileLoadedDocuments()
    expect(io.read).toHaveBeenCalledTimes(1)
    expect(useTabStore.getState().tabs[0]).toMatchObject({ content: '# new', resourceRevision: 1 })
    expect(useTabStore.getState().tabs[1].content).toBeNull()
  })

  it('keeps an unchanged resource-free preview and its revision intact', async () => {
    useTabStore.setState(state => ({ tabs: state.tabs.map(tab => tab.id === 'loaded' ? { ...tab, resourceRevision: 7 } : tab) }))
    const tab = useTabStore.getState().tabs[0]
    io.read.mockResolvedValue('# old\n\n[[target#^block|link]]')
    useTabStore.setState(state => ({ tabs: [{ ...tab, content: '# old\n\n[[target#^block|link]]' }, state.tabs[1]] }))
    const before = useTabStore.getState().tabs[0]
    await reconcileLoadedDocuments()
    expect(useTabStore.getState().tabs[0]).toBe(before)
    expect(io.read).toHaveBeenCalledOnce()
  })

  it.each(['![image](./image.png)', '![[image.png]]', '<video src="clip.mp4"></video>'])('still invalidates unchanged local resources: %s', async resource => {
    const content = `# old\n\n${resource}`
    useTabStore.setState(state => ({ tabs: state.tabs.map(tab => tab.id === 'loaded' ? { ...tab, content, resourceRevision: 7 } : tab) }))
    io.read.mockResolvedValue(content)
    await reconcileLoadedDocuments()
    expect(useTabStore.getState().tabs[0]).toMatchObject({ content, resourceRevision: 8 })
  })

  it('does not manufacture a draft version for an unchanged clean edit session', async () => {
    openSession()
    window.api.openEditableMarkdown = vi.fn().mockResolvedValue({ content: '# old', revisionToken: 'old' })
    const session = useEditSessionStore.getState().sessions[file]
    await reconcileLoadedDocuments()
    expect(useEditSessionStore.getState().sessions[file]).toBe(session)
    expect(useTabStore.getState().tabs[0].resourceRevision).toBeUndefined()
  })

  it('still updates a changed disk revision in a clean edit session', async () => {
    openSession()
    window.api.openEditableMarkdown = vi.fn().mockResolvedValue({ content: '# old', revisionToken: 'new' })
    await reconcileLoadedDocuments()
    expect(useEditSessionStore.getState().sessions[file]).toMatchObject({ draft: '# old', baseRevisionToken: 'new', draftVersion: 1 })
  })

  it('clears missing and rename state even when the restored content is identical', async () => {
    useTabStore.setState(state => ({ tabs: state.tabs.map(tab => tab.id === 'loaded'
      ? { ...tab, missing: true, renameCandidatePath: '/ws/moved.md', resourceRevision: 7 } : tab) }))
    io.read.mockResolvedValue('# old')
    await reconcileLoadedDocuments()
    expect(useTabStore.getState().tabs[0]).toMatchObject({ content: '# old', missing: false, renameCandidatePath: undefined, resourceRevision: 8 })
  })

  it.each(['dirty', 'pendingInput', 'composing', 'saving'] as const)('preserves %s edits made while disk reading was in flight', async (field) => {
    let finish!: (result: any) => void
    openSession()
    window.api.openEditableMarkdown = vi.fn().mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const work = reconcileLoadedDocuments()
    useEditSessionStore.setState(state => ({ sessions: { ...state.sessions, [file]: { ...state.sessions[file], [field]: true, draft: '# local' } } }))
    finish({ content: '# external', revisionToken: 'external' })
    await work
    expect(useEditSessionStore.getState().sessions[file]).toMatchObject({ draft: '# local', conflictReason: 'external_changed' })
    expect(useTabStore.getState().tabs[0].content).toBe('# old')
  })

  it('ignores an old result after the workspace epoch changes', async () => {
    let finish!: (content: string) => void
    io.read.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const work = reconcileLoadedDocuments()
    useWorkspaceStore.setState({ workspaces: [{ id: 'a', primaryRoot: '/ws', lifecycleEpoch: 2 }] as any })
    finish('# stale')
    await work
    expect(useTabStore.getState().tabs[0].content).toBe('# old')
  })

  it('reconciles missing files without deleting dirty drafts or shell tabs', async () => {
    openSession()
    useEditSessionStore.getState().updateDraft(file, '# local')
    window.api.openEditableMarkdown = vi.fn().mockRejectedValue(new Error('missing'))
    window.api.fileExists = vi.fn().mockResolvedValue(false)
    await reconcileLoadedDocuments()
    expect(useEditSessionStore.getState().sessions[file]).toMatchObject({ draft: '# local', conflictReason: 'missing' })
    expect(useTabStore.getState().tabs).toHaveLength(2)
  })
})
