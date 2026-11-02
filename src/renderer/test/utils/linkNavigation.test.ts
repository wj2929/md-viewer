import { describe, expect, it } from 'vitest'
import {
  appendLinkVisit, bindLinkVisits, createRootNavigation, findVisitForTab, reconcileLinkPanels,
  annotateLinkOccurrences, captureLinkView, locateLinkView, MAX_LINK_VISITS,
  type LinkPanelLayout, type LinkLeafNavigation, type LinkVisit,
} from '../../src/utils/linkNavigation'
import { WIKI_LINK_MARKER_ATTRIBUTE, encodeLocalResourceMarker } from '../../../shared/localMedia'

const visit = (name: string, id = name): LinkVisit => ({ id, filePath: `/notes/${name}.md`, tabId: `tab-${name}` })
const layout = (split: boolean, names: Array<[string, string]>, active = names[0]?.[0] ?? 'single'): LinkPanelLayout => ({
  split, activeLeafId: active, leaves: names.map(([id, name]) => ({ id, tabId: `tab-${name}`, filePath: `/notes/${name}.md` })),
})
const tabIds = new Set(['tab-A', 'tab-B', 'tab-C', 'tab-D'])
function abc(): LinkLeafNavigation {
  const a = visit('A'), b = visit('B'), c = visit('C')
  return { chain: appendLinkVisit(appendLinkVisit(undefined, a, b), b, c), bindings: { 'tab-A': a.id, 'tab-B': b.id, 'tab-C': c.id } }
}

describe('本次链接访问链', () => {
  it('A→B→C返回只移游标，B后点D截断旧C分支并使旧绑定失效', () => {
    const state = abc()
    expect(state.chain.visits.map(v => v.id)).toEqual(['A', 'B', 'C'])
    state.chain = { ...state.chain, cursor: 1 }
    expect(state.chain.visits[state.chain.cursor - 1].id).toBe('A')
    const chain = appendLinkVisit(state.chain, visit('B'), visit('D'))
    bindLinkVisits(state, chain, [visit('B'), visit('D')])
    expect(state.chain.visits.map(v => v.id)).toEqual(['A', 'B', 'D'])
    expect(state.bindings['tab-C']).toBeUndefined()
    expect(findVisitForTab(state.chain, 'tab-D', '/notes/D.md', state.bindings['tab-D'])).toBe(2)
    expect(findVisitForTab(state.chain, 'tab-C', '/notes/C.md', 'C')).toBe(-1)
  })
  it('50节点预算只淘汰最旧节点，保留稳定visitId，失效绑定不按旧下标复活', () => {
    let state = { chain: { visits: [visit('0')], cursor: 0 }, bindings: { 'tab-0': '0' } } as LinkLeafNavigation
    for (let n = 1; n <= 75; n++) {
      const source = state.chain.visits[state.chain.cursor]
      const target = visit(String(n))
      bindLinkVisits(state, appendLinkVisit(state.chain, source, target), [source, target])
    }
    expect(state.chain.visits).toHaveLength(MAX_LINK_VISITS)
    expect(state.chain.visits[0].id).toBe('26')
    expect(state.chain.visits[state.chain.cursor].id).toBe('75')
    expect(state.bindings['tab-0']).toBeUndefined()
    expect(findVisitForTab(state.chain, 'tab-0', '/notes/0.md', '0')).toBe(-1)
  })
  it('同文件但不同访问ID不会误接到旧链', () => {
    const state = abc()
    const chain = appendLinkVisit(state.chain, visit('C', 'new-C'), visit('D'))
    expect(chain.visits.map(v => v.id)).toEqual(['new-C', 'D'])
  })
  it('来源标签关闭后保留路径/位置，返回重新绑定新tab而不是旧tabId', () => {
    const state = abc()
    const panel = new Map([['single', state]])
    reconcileLinkPanels(panel, layout(false, [['single', 'C']]), layout(false, [['single', 'C']]), new Set(['tab-C']))
    expect(state.bindings['tab-A']).toBeUndefined()
    expect(state.chain.visits[0].filePath).toBe('/notes/A.md')
    const b = { ...state.chain.visits[1], tabId: 'reopened-B' }
    bindLinkVisits(state, { visits: [state.chain.visits[0], b, state.chain.visits[2]], cursor: 1 }, [b])
    expect(findVisitForTab(state.chain, 'reopened-B', '/notes/B.md', state.bindings['reopened-B'])).toBe(1)
  })
})

describe('面板生命周期与有效标签绑定', () => {
  it('首次分屏single链迁到承载旧文档的firstLeaf，不跟着新activeLeaf跑', () => {
    const state = abc()
    const panels = new Map([['single', state]])
    reconcileLinkPanels(panels, layout(false, [['single', 'C']]), layout(true, [['left', 'C'], ['right', 'D']], 'right'), tabIds)
    expect(panels.get('left')).toBe(state)
    expect(panels.get('right')?.chain.visits).toHaveLength(1)
    expect(panels.has('single')).toBe(false)
  })
  it('新leaf无来源；交换位置保留leaf身份；替换/关闭只清受影响leaf', () => {
    const state = abc()
    const panels = new Map([['left', state]])
    const before = layout(true, [['left', 'C']])
    const split = layout(true, [['left', 'C'], ['right', 'D']])
    reconcileLinkPanels(panels, before, split, tabIds)
    const right = panels.get('right')
    reconcileLinkPanels(panels, split, layout(true, [['right', 'D'], ['left', 'C']], 'right'), tabIds)
    expect(panels.get('left')).toBe(state)
    expect(panels.get('right')).toBe(right)
    reconcileLinkPanels(panels, split, layout(true, [['left', 'D'], ['right', 'D']]), tabIds)
    expect(panels.get('left')?.chain.visits).toHaveLength(1)
    expect(panels.get('right')).toBe(right)
    reconcileLinkPanels(panels, split, layout(true, [['right', 'D']]), tabIds)
    expect(panels.has('left')).toBe(false)
    expect(panels.get('right')).toBe(right)
  })
  it('退出分屏只迁保留的实际leaf，不复制另一侧链', () => {
    const left = abc()
    const right = createRootNavigation({ tabId: 'tab-D', filePath: '/notes/D.md' })
    const panels = new Map([['left', left], ['right', right]])
    reconcileLinkPanels(panels, layout(true, [['left', 'C'], ['right', 'D']], 'right'), layout(false, [['single', 'C']]), tabIds)
    expect(panels.get('single')).toBe(left)
    expect(panels.size).toBe(1)
  })
  it('切有效绑定恢复其visit；切没有绑定的tab建无来源根并使旧visit失效', () => {
    const state = abc()
    const panels = new Map([['single', state]])
    reconcileLinkPanels(panels, layout(false, [['single', 'C']]), layout(false, [['single', 'B']]), tabIds)
    expect(state.chain.cursor).toBe(1)
    expect(state.chain.visits[0].id).toBe('A')
    reconcileLinkPanels(panels, layout(false, [['single', 'B']]), layout(false, [['single', 'D']]), tabIds)
    expect(panels.get('single')?.chain.visits).toHaveLength(1)
    expect(panels.get('single')?.bindings['tab-B']).toBeUndefined()
  })
})

describe('实际正文链接位置', () => {
  it('完整正文同href ordinal区分重复/引用式使用处，Wiki按实际目标而不是#分组', () => {
    const root = document.createElement('div')
    root.innerHTML = '<a href="B.md#x">第一次</a><a href="B.md#x">引用使用处</a><a href="#">Wiki B</a><a href="#">Wiki C</a><a href="#">Wiki B重复</a>'
    const anchors = root.querySelectorAll<HTMLAnchorElement>('a')
    anchors[2].setAttribute(WIKI_LINK_MARKER_ATTRIBUTE, encodeLocalResourceMarker({ rawTarget: 'B#x' }))
    anchors[3].setAttribute(WIKI_LINK_MARKER_ATTRIBUTE, encodeLocalResourceMarker({ rawTarget: 'C#y' }))
    anchors[4].setAttribute(WIKI_LINK_MARKER_ATTRIBUTE, encodeLocalResourceMarker({ rawTarget: 'B#x' }))
    annotateLinkOccurrences(root)
    expect(anchors[1].dataset.mdvLinkOrdinal).toBe('1')
    expect(anchors[2].dataset.mdvLinkKey).toBe('wiki:B#x')
    expect(anchors[3].dataset.mdvLinkOrdinal).toBe('0')
    expect(anchors[4].dataset.mdvLinkOrdinal).toBe('1')
    const dynamic = document.createElement('a'); dynamic.href = 'B.md#x'; root.append(dynamic)
    expect(captureLinkView(root, dynamic).ordinal).toBeUndefined()
  })
  it('同revision定位实际第N个链接；内容变化退到标题，再到比例', () => {
    const scroller = document.createElement('div'); scroller.className = 'preview'
    Object.defineProperties(scroller, { scrollHeight: { value: 1000 }, clientHeight: { value: 200 } })
    const root = document.createElement('div')
    root.innerHTML = '<h2 id="section">标题</h2><a href="B.md">1</a><a href="B.md">2</a>'
    scroller.append(root); annotateLinkOccurrences(root)
    const anchors = root.querySelectorAll<HTMLAnchorElement>('a')
    const position = { revision: 'r1', linkKey: 'B.md', ordinal: 1, viewportOffset: 20, headingId: 'section', headingOffset: 10, scrollRatio: .4 }
    expect(locateLinkView(root, position, 'r1')).toBe(anchors[1])
    expect(locateLinkView(root, position, 'r2')).toBe(root.querySelector('h2'))
    root.querySelector('h2')?.remove()
    expect(locateLinkView(root, position, 'r2')).toBeNull()
    expect(scroller.scrollTop).toBe(320)
  })
})
