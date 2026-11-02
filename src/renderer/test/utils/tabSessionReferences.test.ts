import { describe, expect, it } from 'vitest'
import { normalizeTabSessionReferences, type TabSessionNode } from '../../../shared/tabSessionReferences'

const root: TabSessionNode = { type: 'split', id: 'split', direction: 'horizontal', ratio: .5,
  first: { type: 'leaf', id: 'owned-leaf', tabId: 'owned' },
  second: { type: 'leaf', id: 'external-leaf', tabId: 'external' } }

describe('会话过滤后的引用归一化', () => {
  it('外部活动tab和leaf移除后回退根内tab，折叠空分支', () => {
    expect(normalizeTabSessionReferences([{ id: 'owned' }], 'external', { root, activeLeafId: 'external-leaf' }))
      .toEqual({ activeTabId: 'owned', splitState: { root: root.first, activeLeafId: 'owned-leaf' } })
  })
  it('全部临时tab被过滤时不留下悬空引用', () => {
    expect(normalizeTabSessionReferences([], 'external', { root, activeLeafId: 'external-leaf' }))
      .toEqual({ activeTabId: null, splitState: { root: null, activeLeafId: '' } })
  })
  it('保留仍有效的活动tab、双leaf及方向比例', () => {
    expect(normalizeTabSessionReferences([{ id: 'owned' }, { id: 'external' }], 'owned', { root, activeLeafId: 'external-leaf' }))
      .toEqual({ activeTabId: 'owned', splitState: { root, activeLeafId: 'external-leaf' } })
  })
  it('空树、无效输入和循环输入受控，不携带其它快照字段', () => {
    expect(normalizeTabSessionReferences([{ id: 'owned' }], null, { root: null, content: '不保存的正文', documentId: '不保存的凭据' }))
      .toEqual({ activeTabId: 'owned', splitState: { root: null, activeLeafId: '' } })
    const cyclic: Record<string, unknown> = { type: 'split', id: 'loop' }
    cyclic.first = cyclic; cyclic.second = cyclic
    expect(normalizeTabSessionReferences([], null, { root: cyclic }).splitState.root).toBeNull()
  })
})
