import { WIKI_LINK_MARKER_ATTRIBUTE } from '../../../shared/localMedia'
import { decodeLocalResourceMarker } from '../../../shared/localMedia'
import type { ParsedWikiReference } from '../../../shared/markdown/obsidianSyntax'

export const SINGLE_NAVIGATION_LEAF = 'single'
export const MAX_LINK_VISITS = 50

export interface LinkViewPosition {
  revision?: string
  linkKey?: string
  ordinal?: number
  viewportOffset?: number
  headingId?: string
  headingOffset?: number
  scrollRatio: number
}

export interface PreviewLinkContext {
  filePath: string
  tabId?: string
  leafId: string
  position: LinkViewPosition
  revision: Promise<string | undefined>
  anchor: HTMLAnchorElement
  wikiEmbed?: boolean
}

export interface LinkVisit {
  id: string
  filePath: string
  tabId?: string
  documentId?: string
  position?: LinkViewPosition
}
export interface LinkVisitChain {
  visits: LinkVisit[]
  cursor: number
}
export interface LinkLeafNavigation {
  chain: LinkVisitChain
  bindings: Record<string, string>
  requestId?: string
  pending?: boolean
  positionRequest?: LinkPositionRequest
}

export interface LinkPositionRequest {
  id: string
  filePath: string
  position: LinkViewPosition
  block?: { id: string; source: string; deadline: number }
  canFocus: () => boolean
  isCurrent: () => boolean
  onComplete: (status?: 'positioned' | 'missing' | 'ambiguous' | 'unavailable' | 'cancelled') => void
}

export function appendLinkVisit(chain: LinkVisitChain | undefined, source: LinkVisit, target: LinkVisit): LinkVisitChain {
  const visits = chain && chain.visits[chain.cursor]?.id === source.id
    && chain.visits[chain.cursor]?.filePath === source.filePath
    ? [...chain.visits.slice(0, chain.cursor), source, target] : [source, target]
  const bounded = visits.slice(-MAX_LINK_VISITS)
  return { visits: bounded, cursor: bounded.length - 1 }
}

export function findVisitForTab(chain: LinkVisitChain | undefined, tabId: string, filePath: string, visitId: string | undefined): number {
  if (!chain || !visitId) return -1
  return chain.visits.findIndex(visit => visit.id === visitId && visit.tabId === tabId && visit.filePath === filePath)
}

export async function previewRevision(content: string): Promise<string | undefined> {
  if (!globalThis.crypto?.subtle) return undefined
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

function anchorKey(anchor: HTMLAnchorElement): string {
  const wiki = anchor.getAttribute(WIKI_LINK_MARKER_ATTRIBUTE)
  if (wiki) {
    const parsed = decodeLocalResourceMarker<ParsedWikiReference>(wiki)
    return parsed ? `wiki:${parsed.rawTarget}` : ''
  }
  return anchor.getAttribute('href') ?? ''
}

// 在图表hydrate前调用；动态生成的链接没有正文occurrence，只用标题/比例回退。
export function annotateLinkOccurrences(root: HTMLElement): void {
  for (const heading of root.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6')) heading.dataset.mdvStaticHeading = 'true'
  const counts = new Map<string, number>()
  for (const anchor of root.querySelectorAll<HTMLAnchorElement>('a')) {
    const key = anchorKey(anchor)
    const ordinal = counts.get(key) ?? 0
    counts.set(key, ordinal + 1)
    anchor.dataset.mdvLinkKey = key
    anchor.dataset.mdvLinkOrdinal = String(ordinal)
  }
}

export function captureLinkView(root: HTMLElement, anchor: HTMLAnchorElement): LinkViewPosition {
  const scroller = (root.closest('.preview') ?? root.parentElement ?? root) as HTMLElement
  const top = scroller.getBoundingClientRect().top
  const headings = Array.from(root.querySelectorAll<HTMLElement>('[data-mdv-static-heading]'))
  const heading = headings.filter(node => node.getBoundingClientRect().top <= anchor.getBoundingClientRect().top).at(-1)
  return {
    scrollRatio: Math.max(0, Math.min(1, scroller.scrollTop / Math.max(1, scroller.scrollHeight - scroller.clientHeight))),
    ...(anchor.dataset.mdvLinkKey !== undefined ? {
      linkKey: anchor.dataset.mdvLinkKey, ordinal: Number(anchor.dataset.mdvLinkOrdinal),
      viewportOffset: anchor.getBoundingClientRect().top - top,
    } : {}),
    ...(heading?.id ? { headingId: heading.id, headingOffset: heading.getBoundingClientRect().top - top } : {}),
  }
}

export function locateMarkdownBlock(root: HTMLElement, target: HTMLElement): boolean {
  if (!target.isConnected || !root.contains(target)) return false
  const scroller = (root.closest('.preview') ?? root.parentElement ?? root) as HTMLElement
  scroller.scrollTop += target.getBoundingClientRect().top - scroller.getBoundingClientRect().top
  return true
}

export function locateLinkView(root: HTMLElement, position: LinkViewPosition, revision?: string): HTMLElement | null {
  const scroller = (root.closest('.preview') ?? root.parentElement ?? root) as HTMLElement
  const sameRevision = Boolean(position.revision && position.revision === revision)
  const anchor = sameRevision ? Array.from(root.querySelectorAll<HTMLElement>('[data-mdv-link-key]'))
    .find(node => node.dataset.mdvLinkKey === position.linkKey && Number(node.dataset.mdvLinkOrdinal) === position.ordinal) : undefined
  const heading = position.headingId ? Array.from(root.querySelectorAll<HTMLElement>('[data-mdv-static-heading]'))
    .find(node => node.id === position.headingId) : undefined
  const target = anchor ?? heading
  if (target) {
    const offset = anchor ? position.viewportOffset ?? 0 : position.headingOffset ?? 0
    scroller.scrollTop += target.getBoundingClientRect().top - scroller.getBoundingClientRect().top - offset
  } else scroller.scrollTop = position.scrollRatio * Math.max(0, scroller.scrollHeight - scroller.clientHeight)
  return target ?? null
}

export interface LinkPanelIdentity { id: string; tabId: string; filePath: string }
export interface LinkPanelLayout { split: boolean; activeLeafId: string; leaves: LinkPanelIdentity[] }

export function createRootNavigation(tab: Pick<LinkPanelIdentity, 'tabId' | 'filePath'>): LinkLeafNavigation {
  const visit = { id: crypto.randomUUID(), filePath: tab.filePath, tabId: tab.tabId }
  return { chain: { visits: [visit], cursor: 0 }, bindings: { [tab.tabId]: visit.id } }
}

export function bindLinkVisits(state: LinkLeafNavigation, chain: LinkVisitChain, visits: LinkVisit[]): void {
  const valid = new Set(chain.visits.map(visit => visit.id))
  state.bindings = Object.fromEntries(Object.entries(state.bindings).filter(([, id]) => valid.has(id)))
  for (const visit of visits) if (visit.tabId) state.bindings[visit.tabId] = visit.id
  state.chain = chain
}

export function reconcileLinkPanels(
  panels: Map<string, LinkLeafNavigation>, previous: LinkPanelLayout | undefined,
  current: LinkPanelLayout, tabIds: Set<string>,
): boolean {
  let changed = false
  if (previous && previous.split !== current.split) {
    if (!previous.split) {
      const source = panels.get(SINGLE_NAVIGATION_LEAF)
      const leaf = current.leaves.find(item => item.tabId === previous.leaves[0]?.tabId)
      if (source && leaf) {
        source.requestId = undefined; source.pending = false; source.positionRequest = undefined
        panels.set(leaf.id, source)
      }
      panels.delete(SINGLE_NAVIGATION_LEAF)
    } else {
      const target = current.leaves[0]
      const preferred = previous.leaves.find(leaf => leaf.id === previous.activeLeafId && leaf.tabId === target?.tabId)
        ?? previous.leaves.find(leaf => leaf.tabId === target?.tabId)
      const source = preferred && panels.get(preferred.id)
      if (source) {
        source.requestId = undefined; source.pending = false; source.positionRequest = undefined
        panels.set(SINGLE_NAVIGATION_LEAF, source)
      }
    }
    changed = true
  }
  const ids = new Set(current.leaves.map(leaf => leaf.id))
  for (const id of panels.keys()) if (!ids.has(id)) { panels.delete(id); changed = true }
  for (const leaf of current.leaves) {
    const state = panels.get(leaf.id)
    if (!state) { panels.set(leaf.id, createRootNavigation(leaf)); changed = true; continue }
    for (const tabId of Object.keys(state.bindings)) {
      if (!tabIds.has(tabId)) { delete state.bindings[tabId]; changed = true }
    }
    const visit = state.chain.visits[state.chain.cursor]
    if (visit?.tabId === leaf.tabId && visit.filePath === leaf.filePath) continue
    const cursor = findVisitForTab(state.chain, leaf.tabId, leaf.filePath, state.bindings[leaf.tabId])
    if (cursor < 0) panels.set(leaf.id, createRootNavigation(leaf))
    else { state.chain = { ...state.chain, cursor }; state.requestId = undefined; state.pending = false; state.positionRequest = undefined }
    changed = true
  }
  return changed
}

export interface LinkOrigin {
  name: string
  description?: string
  busy: boolean
  onReturn: () => void
}
