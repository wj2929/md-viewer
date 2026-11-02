export type TabSessionNode =
  | { type: 'leaf'; id: string; tabId: string }
  | { type: 'split'; id: string; direction: 'horizontal' | 'vertical'; ratio: number; first: TabSessionNode; second: TabSessionNode }

// 只归一化引用，不决定哪些文件可读或可保存。调用者先过滤自己的 tab 集合。
export function normalizeTabSessionReferences(
  tabs: readonly { id: string }[], activeTabId: string | null, splitState: unknown,
): { activeTabId: string | null; splitState: { root: TabSessionNode | null; activeLeafId: string } } {
  const ids = new Set(tabs.map(tab => tab.id))
  const state = splitState && typeof splitState === 'object' ? splitState as Record<string, unknown> : {}
  const walk = (value: unknown, depth = 0): TabSessionNode | null => {
    if (!value || typeof value !== 'object' || depth > 16) return null
    const node = value as Record<string, unknown>
    if (typeof node.id !== 'string') return null
    if (node.type === 'leaf') return typeof node.tabId === 'string' && ids.has(node.tabId)
      ? { type: 'leaf', id: node.id, tabId: node.tabId } : null
    if (node.type !== 'split') return null
    const first = walk(node.first, depth + 1), second = walk(node.second, depth + 1)
    if (!first) return second
    if (!second) return first
    if ((node.direction !== 'horizontal' && node.direction !== 'vertical') || typeof node.ratio !== 'number' || !Number.isFinite(node.ratio)) return null
    return { type: 'split', id: node.id, direction: node.direction, ratio: node.ratio, first, second }
  }
  const root = walk(state.root)
  const leaves: { id: string }[] = []
  const collect = (node: TabSessionNode): void => {
    if (node.type === 'leaf') leaves.push(node)
    else { collect(node.first); collect(node.second) }
  }
  if (root) collect(root)
  return {
    activeTabId: activeTabId && ids.has(activeTabId) ? activeTabId : tabs[0]?.id ?? null,
    splitState: { root, activeLeafId: leaves.some(leaf => leaf.id === state.activeLeafId)
      ? state.activeLeafId as string : leaves[0]?.id ?? '' },
  }
}
