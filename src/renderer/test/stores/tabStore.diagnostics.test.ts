import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { useTabStore } from '../../src/stores/tabStore'
import { useWorkspaceStore } from '../../src/stores/workspaceStore'
import { recordPaneHydration } from '../../src/utils/paneDiagnostics'
import { sanitizeRendererDiagnosticEvent, type RendererDiagnosticEventInput } from '../../../shared/diagnostics'
import type { SplitState } from '../../src/utils/splitTree'

const record = vi.fn()
const tabs = ['a', 'b'].map(id => ({
  id: `private-tab-${id}`,
  file: { name: `Secret ${id}.md`, path: `/Users/private/${id}.md`, isDirectory: false },
  content: 'Private business text',
}))
const split: SplitState = {
  root: { type: 'split', id: 'private-root', direction: 'horizontal', ratio: 0.43,
    first: { type: 'leaf', id: 'private-leaf-a', tabId: tabs[0].id },
    second: { type: 'split', id: 'private-right', direction: 'vertical', ratio: 0.62,
      first: { type: 'leaf', id: 'private-leaf-b1', tabId: tabs[1].id },
      second: { type: 'leaf', id: 'private-leaf-b2', tabId: tabs[1].id } } },
  activeLeafId: 'private-leaf-b2',
}
const events = () => record.mock.calls.map(([event]) => event as RendererDiagnosticEventInput)

beforeEach(() => {
  vi.stubGlobal('window', { ...window, api: { recordDiagnosticRendererEvent: record } })
  record.mockReset()
  useWorkspaceStore.setState({ workspaces: [
    { id: 'private-workspace-a', name: 'Secret A', primaryRoot: '/Users/private/a', lifecycleEpoch: 4 },
    { id: 'private-workspace-b', name: 'Secret B', primaryRoot: '/Users/private/b', lifecycleEpoch: 7 },
  ], activeWorkspaceId: 'private-workspace-a', runtimes: {} })
  useTabStore.setState({ tabs, activeTabId: tabs[1].id, splitState: split })
  recordPaneHydration('private-workspace-a')
  record.mockClear()
})

afterEach(() => { vi.unstubAllGlobals() })

describe('pane diagnostics', () => {
  it('保留嵌套写入顺序、固定来源和 tab 到 leaf 同步关联', () => {
    const store = useTabStore.getState()
    const cause = { source: 'panel-click', inputTrusted: true } as const
    store.setSplitState(previous => {
      store.setActiveTabId(tabs[0].id, cause)
      return { ...previous, activeLeafId: 'private-leaf-a' }
    }, cause)
    expect(events()).toHaveLength(2)
    const [tab, leaf] = events()
    expect(tab.metadata).toMatchObject({ paneAction: 'tab', paneSource: 'panel-click', inputTrusted: true, beforeTabSlot: 1, afterTabSlot: 0, workspaceEpoch: 4 })
    expect(leaf.metadata).toMatchObject({ paneAction: 'split', beforeLeafPosition: 'root.second.second', afterLeafPosition: 'root.first', lastTabChangeSequence: tab.metadata!.paneSequence })
    expect(Number(leaf.metadata!.paneSequence)).toBe(Number(tab.metadata!.paneSequence) + 1)
    record.mockClear()
    store.setActiveTabId(tabs[1].id, { source: 'tab-click', operationId: 'file_12345678' })
    store.setSplitState(previous => ({ ...previous, activeLeafId: 'private-leaf-b1' }), { source: 'active-tab-sync' })
    expect(events()[1].operationId).toBe('file_12345678')
    expect(events()[1].metadata).toMatchObject({ paneSource: 'active-tab-sync', lastTabChangeSequence: events()[0].metadata!.paneSequence })
  })

  it('同文档不同 leaf 仍记录精确树位置且不泄漏标识或内容', () => {
    useTabStore.getState().setSplitState({ ...split, activeLeafId: 'private-leaf-b1' }, { source: 'panel-click', inputTrusted: false })
    expect(events()[0].metadata).toMatchObject({ beforeLeafPosition: 'root.second.second', afterLeafPosition: 'root.second.first', tabChanged: false, leafChanged: true, leafDocumentChanged: false, inputTrusted: false })
    const text = JSON.stringify(events())
    for (const secret of ['private-', '/Users/', 'Secret', 'business text']) expect(text).not.toContain(secret)
    for (const event of events()) expect(sanitizeRendererDiagnosticEvent(event)).toEqual(event)
  })

  it('只移动现有活动 leaf 的位置也记录，不把 ratio 调整刷成日志', () => {
    const root = split.root!
    if (root.type !== 'split') throw new Error('fixture')
    useTabStore.getState().setSplitState({ ...split, root: { ...root, first: root.second, second: root.first } }, { source: 'panel-swap' })
    expect(events()[0].metadata).toMatchObject({ beforeLeafPosition: 'root.second.second', afterLeafPosition: 'root.first.second', leafChanged: false })
    record.mockClear()
    useTabStore.getState().setSplitState(previous => previous.root?.type === 'split'
      ? { ...previous, root: { ...previous.root, ratio: 0.55 } } : previous, { source: 'panel-resize' })
    useTabStore.getState().setActiveTabId(tabs[1].id, { source: 'tab-click' })
    useTabStore.getState().updateTabContent(tabs[1].id, 'new private text')
    expect(record).not.toHaveBeenCalled()
  })

  it('工作区代次和每次 hydration 可关联，但不输出原始工作区 ID', () => {
    recordPaneHydration('private-workspace-a')
    const a = events()[0].metadata!
    useWorkspaceStore.getState().setActiveWorkspaceId('private-workspace-b')
    recordPaneHydration('private-workspace-b')
    const b = events()[1].metadata!
    useWorkspaceStore.getState().setActiveWorkspaceId('private-workspace-a')
    recordPaneHydration('private-workspace-a')
    const returned = events()[2].metadata!
    expect(a.workspaceTraceId).toBe(returned.workspaceTraceId)
    expect(a.workspaceTraceId).not.toBe(b.workspaceTraceId)
    expect(b.workspaceEpoch).toBe(7)
    expect(Number(returned.hydrationGeneration)).toBe(Number(a.hydrationGeneration) + 2)
    expect(JSON.stringify(events())).not.toContain('private')
  })

  it('空树与无效 leaf 有明确位置，不伪造有效面板', () => {
    useTabStore.getState().setSplitState({ ...split, activeLeafId: 'nonexistent-private' }, { source: 'restore-folder-session' })
    useTabStore.getState().setSplitState({ root: null, activeLeafId: '' }, { source: 'folder-switch' })
    expect(events()[0].metadata!.afterLeafPosition).toBe('missing')
    expect(events()[1].metadata!.afterLeafPosition).toBe('none')
  })

  it('bridge 写日志失败不影响嵌套 setter 结果或调用次数', () => {
    record.mockImplementation(() => { throw new Error('bridge unavailable') })
    const update = vi.fn(previous => ({ ...previous, activeLeafId: 'private-leaf-a' }))
    expect(() => useTabStore.getState().setSplitState(update, { source: 'panel-click' })).not.toThrow()
    expect(update).toHaveBeenCalledTimes(1)
    expect(useTabStore.getState().splitState.activeLeafId).toBe('private-leaf-a')
    expect(() => recordPaneHydration('private-workspace-b')).not.toThrow()
  })
})
