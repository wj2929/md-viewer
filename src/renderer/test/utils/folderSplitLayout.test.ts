import { describe, expect, it } from 'vitest'
import type { Tab } from '../../src/components/TabBar'
import type { SplitState } from '../../src/utils/splitTree'
import {
  restoreFolderSplitLayout,
  serializeFolderSplitLayout,
} from '../../src/utils/folderSplitLayout'

const tabs: Tab[] = [
  { id: 'tab-a', file: { name: 'a.md', path: '/workspace/a.md', isDirectory: false }, content: null },
  { id: 'tab-b', file: { name: 'b.md', path: '/workspace/docs/b.md', isDirectory: false }, content: null },
  { id: 'tab-out', file: { name: 'out.md', path: '/outside/out.md', isDirectory: false }, content: null },
]

describe('folderSplitLayout', () => {
  it('将 runtime IDs 序列化为相对路径与结构 active path', () => {
    const splitState: SplitState = {
      root: {
        type: 'split', id: 'split', direction: 'horizontal', ratio: 0.6,
        first: { type: 'leaf', id: 'leaf-a', tabId: 'tab-a' },
        second: { type: 'leaf', id: 'leaf-b', tabId: 'tab-b' },
      },
      activeLeafId: 'leaf-b',
    }

    expect(serializeFolderSplitLayout(splitState, tabs, '/workspace', {
      'leaf-a': { filePath: '/workspace/a.md', scrollRatio: 0.2, headingId: 'one' },
      'leaf-b': { filePath: '/workspace/docs/b.md', scrollRatio: 0.8, headingId: 'eight' },
    })).toEqual({
      version: 1,
      root: {
        type: 'split', direction: 'horizontal', ratio: 0.6,
        first: { type: 'leaf', relativePath: 'a.md', viewState: { scrollRatio: 0.2, headingId: 'one' } },
        second: { type: 'leaf', relativePath: 'docs/b.md', viewState: { scrollRatio: 0.8, headingId: 'eight' } },
      },
      activeLeafPath: [1],
    })
  })

  it('删除根外 leaf 后收缩布局', () => {
    const splitState: SplitState = {
      root: {
        type: 'split', id: 'split', direction: 'vertical', ratio: 0.5,
        first: { type: 'leaf', id: 'inside', tabId: 'tab-a' },
        second: { type: 'leaf', id: 'outside', tabId: 'tab-out' },
      },
      activeLeafId: 'outside',
    }

    expect(serializeFolderSplitLayout(splitState, tabs, '/workspace', {})).toEqual({
      version: 1,
      root: { type: 'leaf', relativePath: 'a.md' },
      activeLeafPath: null,
    })
  })

  it('恢复时重建 panel IDs 并保留同文档多 leaf', () => {
    const restored = restoreFolderSplitLayout({
      version: 1,
      root: {
        type: 'split', direction: 'horizontal', ratio: 0.55,
        first: { type: 'leaf', relativePath: 'a.md', viewState: { scrollRatio: 0.1 } },
        second: { type: 'leaf', relativePath: 'a.md', viewState: { scrollRatio: 0.9 } },
      },
      activeLeafPath: [1],
    }, tabs, '/workspace')

    expect(restored?.splitState.root?.type).toBe('split')
    if (!restored || restored.splitState.root?.type !== 'split') throw new Error('split restore failed')
    expect(restored.splitState.root.first.type).toBe('leaf')
    expect(restored.splitState.root.second.type).toBe('leaf')
    if (restored.splitState.root.first.type !== 'leaf' || restored.splitState.root.second.type !== 'leaf') {
      throw new Error('leaf restore failed')
    }
    expect(restored.splitState.root.first.tabId).toBe('tab-a')
    expect(restored.splitState.root.second.tabId).toBe('tab-a')
    expect(restored.splitState.activeLeafId).toBe(restored.splitState.root.second.id)
    expect(restored.leafViewStates[restored.splitState.root.first.id].scrollRatio).toBe(0.1)
    expect(restored.leafViewStates[restored.splitState.root.second.id].scrollRatio).toBe(0.9)
  })
})
