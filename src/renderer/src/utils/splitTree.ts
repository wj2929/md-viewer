/**
 * 递归分屏树数据模型与操作工具函数
 * @module splitTree
 * @description v1.5.1 分屏增强 - 支持 N 面板递归分屏
 */

let _nextId = 1
export function generateId(): string {
  return `panel-${_nextId++}`
}

/** 叶子节点：显示一个标签页 */
export interface LeafNode {
  type: 'leaf'
  id: string
  tabId: string
}

/** 分割节点：包含两个子节点 */
export interface SplitNode {
  type: 'split'
  id: string
  direction: 'horizontal' | 'vertical'
  ratio: number
  first: PanelNode
  second: PanelNode
}

export type PanelNode = LeafNode | SplitNode

/** 分屏状态 */
export interface SplitState {
  root: PanelNode | null
  activeLeafId: string
}

/** 创建叶子节点 */
export function createLeaf(tabId: string): LeafNode {
  return { type: 'leaf', id: generateId(), tabId }
}

/** 在指定叶子节点处分屏，返回新的树根 */
export function splitLeaf(
  root: PanelNode,
  leafId: string,
  direction: 'horizontal' | 'vertical',
  newTabId: string
): { root: PanelNode; newLeafId: string } {
  const newLeaf = createLeaf(newTabId)

  function walk(node: PanelNode): PanelNode {
    if (node.type === 'leaf') {
      if (node.id === leafId) {
        const splitNode: SplitNode = {
          type: 'split',
          id: generateId(),
          direction,
          ratio: 0.5,
          first: node,
          second: newLeaf
        }
        return splitNode
      }
      return node
    }
    return {
      ...node,
      first: walk(node.first),
      second: walk(node.second)
    }
  }

  return { root: walk(root), newLeafId: newLeaf.id }
}

/** 关闭指定叶子节点，合并父节点。返回 null 表示树为空 */
export function closeLeaf(root: PanelNode, leafId: string): PanelNode | null {
  if (root.type === 'leaf') {
    return root.id === leafId ? null : root
  }

  // 如果要关闭的叶子是 first 或 second 的直接子节点
  if (root.first.type === 'leaf' && root.first.id === leafId) {
    return root.second
  }
  if (root.second.type === 'leaf' && root.second.id === leafId) {
    return root.first
  }

  // 递归处理子树
  const newFirst = closeLeaf(root.first, leafId)
  const newSecond = closeLeaf(root.second, leafId)

  // 如果某个子树被完全移除（不应该发生，但防御性处理）
  if (newFirst === null) return newSecond
  if (newSecond === null) return newFirst

  return { ...root, first: newFirst, second: newSecond }
}

/** 更新分割比例 */
export function updateRatio(root: PanelNode, splitId: string, ratio: number): PanelNode {
  const clampedRatio = Math.max(0.15, Math.min(0.85, ratio))

  if (root.type === 'leaf') return root

  if (root.id === splitId) {
    return { ...root, ratio: clampedRatio }
  }

  return {
    ...root,
    first: updateRatio(root.first, splitId, ratio),
    second: updateRatio(root.second, splitId, ratio)
  }
}

/** 更新叶子节点的 tabId */
export function updateLeafTab(root: PanelNode, leafId: string, tabId: string): PanelNode {
  if (root.type === 'leaf') {
    if (root.id === leafId) {
      return { ...root, tabId }
    }
    return root
  }

  return {
    ...root,
    first: updateLeafTab(root.first, leafId, tabId),
    second: updateLeafTab(root.second, leafId, tabId)
  }
}

/** 查找叶子节点 */
export function findLeaf(root: PanelNode | null, leafId: string): LeafNode | null {
  if (!root) return null
  if (root.type === 'leaf') {
    return root.id === leafId ? root : null
  }
  return findLeaf(root.first, leafId) || findLeaf(root.second, leafId)
}

/** 获取所有叶子节点 */
export function getAllLeaves(root: PanelNode | null): LeafNode[] {
  if (!root) return []
  if (root.type === 'leaf') return [root]
  return [...getAllLeaves(root.first), ...getAllLeaves(root.second)]
}

/** 查找包含指定 tabId 的叶子节点 */
export function findLeafByTabId(root: PanelNode | null, tabId: string): LeafNode | null {
  if (!root) return null
  if (root.type === 'leaf') {
    return root.tabId === tabId ? root : null
  }
  return findLeafByTabId(root.first, tabId) || findLeafByTabId(root.second, tabId)
}

/** 获取树的最大深度（用于限制嵌套层数） */
export function getTreeDepth(root: PanelNode | null): number {
  if (!root) return 0
  if (root.type === 'leaf') return 1
  return 1 + Math.max(getTreeDepth(root.first), getTreeDepth(root.second))
}

/** 交换两个叶子节点的 tabId */
export function swapLeaves(root: PanelNode, leafIdA: string, leafIdB: string): PanelNode {
  const leafA = findLeaf(root, leafIdA)
  const leafB = findLeaf(root, leafIdB)
  if (!leafA || !leafB || leafA.id === leafB.id) return root

  const tabIdA = leafA.tabId
  const tabIdB = leafB.tabId
  let result = updateLeafTab(root, leafIdA, tabIdB)
  result = updateLeafTab(result, leafIdB, tabIdA)
  return result
}

/** 清空所有叶子节点的 tabId（保留树结构） */
export function clearAllLeafTabs(root: PanelNode): PanelNode {
  if (root.type === 'leaf') {
    return { ...root, tabId: '' }
  }
  return {
    ...root,
    first: clearAllLeafTabs(root.first),
    second: clearAllLeafTabs(root.second)
  }
}

/** 最大允许深度 */
export const MAX_SPLIT_DEPTH = 4
