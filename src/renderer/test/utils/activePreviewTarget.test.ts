import { describe, expect, it } from 'vitest'
import type { Tab } from '../../src/components/TabBar'
import type { SplitState } from '../../src/utils/splitTree'
import { resolveActivePreviewTarget } from '../../src/utils/activePreviewTarget'

const tabs: Tab[] = [
  { id: 'tab-a', file: { name: 'a.md', path: '/docs/a.md', isDirectory: false }, content: '# A' },
  { id: 'tab-b', file: { name: 'b.md', path: '/docs/b.md', isDirectory: false }, content: '# B' },
]

describe('resolveActivePreviewTarget', () => {
  it('returns activeTabId target in non-split mode', () => {
    const splitState: SplitState = { root: null, activeLeafId: '' }

    expect(resolveActivePreviewTarget(tabs, 'tab-a', splitState)?.tab.id).toBe('tab-a')
  })

  it('returns active leaf target in split mode', () => {
    const splitState: SplitState = {
      activeLeafId: 'leaf-b',
      root: {
        type: 'split',
        id: 'split-1',
        direction: 'horizontal',
        ratio: 0.5,
        first: { type: 'leaf', id: 'leaf-a', tabId: 'tab-a' },
        second: { type: 'leaf', id: 'leaf-b', tabId: 'tab-b' },
      },
    }

    expect(resolveActivePreviewTarget(tabs, 'tab-a', splitState)?.tab.id).toBe('tab-b')
  })

  it('falls back to activeTabId when active leaf is missing', () => {
    const splitState: SplitState = {
      activeLeafId: 'missing',
      root: { type: 'leaf', id: 'leaf-a', tabId: 'tab-a' },
    }

    expect(resolveActivePreviewTarget(tabs, 'tab-b', splitState)?.tab.id).toBe('tab-b')
  })
})
