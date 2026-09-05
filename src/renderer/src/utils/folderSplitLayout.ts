import type { Tab } from '../components/TabBar'
import type {
  FolderSplitLayoutV1,
  FolderSplitLeafViewState,
  PersistedFolderSplitNode,
} from '../../../shared/folderTabSession'
import {
  createLeaf,
  generateId,
  type PanelNode,
  type SplitState,
} from './splitTree'

export type FolderSplitLeafPositions = Record<string, {
  filePath: string
  scrollRatio: number
  headingId?: string
  contentHash?: string
}>

export interface RestoredFolderSplitLayout {
  splitState: SplitState
  leafViewStates: Record<string, FolderSplitLeafViewState>
}

interface SerializedNode {
  node: PersistedFolderSplitNode
  activePath: number[] | null
}

interface RestoredNode {
  node: PanelNode
  activeLeafId: string
}

export function serializeFolderSplitLayout(
  splitState: SplitState,
  tabs: readonly Tab[],
  folderPath: string,
  leafPositions: FolderSplitLeafPositions,
): FolderSplitLayoutV1 | undefined {
  if (!splitState.root) return undefined
  const tabPaths = new Map(tabs.map(tab => [tab.id, tab.file.path]))

  const walk = (node: PanelNode): SerializedNode | null => {
    if (node.type === 'leaf') {
      const filePath = tabPaths.get(node.tabId)
      const relativePath = filePath ? toRelativePath(folderPath, filePath) : null
      if (!relativePath) return null
      const position = leafPositions[node.id]
      const viewState = position?.filePath === filePath
        ? {
            scrollRatio: Math.max(0, Math.min(1, position.scrollRatio)),
            ...(position.headingId ? { headingId: position.headingId } : {}),
            ...(position.contentHash ? { contentHash: position.contentHash } : {}),
          }
        : undefined
      return {
        node: {
          type: 'leaf',
          relativePath,
          ...(viewState ? { viewState } : {}),
        },
        activePath: node.id === splitState.activeLeafId ? [] : null,
      }
    }

    const first = walk(node.first)
    const second = walk(node.second)
    if (!first) return second
    if (!second) return first
    return {
      node: {
        type: 'split',
        direction: node.direction,
        ratio: node.ratio,
        first: first.node,
        second: second.node,
      },
      activePath: first.activePath
        ? [0, ...first.activePath]
        : second.activePath ? [1, ...second.activePath] : null,
    }
  }

  const result = walk(splitState.root)
  if (!result) return undefined
  return { version: 1, root: result.node, activeLeafPath: result.activePath }
}

export function restoreFolderSplitLayout(
  layout: FolderSplitLayoutV1 | undefined,
  tabs: readonly Tab[],
  folderPath: string,
): RestoredFolderSplitLayout | undefined {
  if (!layout || layout.version !== 1 || !layout.root) return undefined
  const tabsByRelativePath = new Map<string, Tab>()
  for (const tab of tabs) {
    const relativePath = toRelativePath(folderPath, tab.file.path)
    if (relativePath) tabsByRelativePath.set(relativePath, tab)
  }

  const leafViewStates: Record<string, FolderSplitLeafViewState> = {}
  const walk = (node: PersistedFolderSplitNode, structuralPath: number[]): RestoredNode | null => {
    if (node.type === 'leaf') {
      const tab = tabsByRelativePath.get(node.relativePath)
      if (!tab) return null
      const leaf = createLeaf(tab.id)
      if (node.viewState) leafViewStates[leaf.id] = node.viewState
      return {
        node: leaf,
        activeLeafId: pathsEqual(structuralPath, layout.activeLeafPath) ? leaf.id : '',
      }
    }

    const first = walk(node.first, [...structuralPath, 0])
    const second = walk(node.second, [...structuralPath, 1])
    if (!first) return second
    if (!second) return first
    return {
      node: {
        type: 'split',
        id: generateId(),
        direction: node.direction,
        ratio: Math.max(0.15, Math.min(0.85, node.ratio)),
        first: first.node,
        second: second.node,
      },
      activeLeafId: first.activeLeafId || second.activeLeafId,
    }
  }

  const result = walk(layout.root, [])
  if (!result) return undefined
  return {
    splitState: { root: result.node, activeLeafId: result.activeLeafId || firstLeafId(result.node) },
    leafViewStates,
  }
}

function toRelativePath(folderPath: string, filePath: string): string | null {
  const separator = folderPath.includes('\\') ? '\\' : '/'
  const normalizedRoot = folderPath.replace(/[\\/]+$/, '')
  if (!filePath.startsWith(`${normalizedRoot}${separator}`)) return null
  const relative = filePath.slice(normalizedRoot.length + 1)
  if (!relative || relative.split(/[\\/]+/).includes('..')) return null
  return relative
}

function pathsEqual(left: readonly number[], right: readonly number[] | null): boolean {
  return Boolean(right && left.length === right.length && left.every((value, index) => value === right[index]))
}

function firstLeafId(node: PanelNode): string {
  return node.type === 'leaf' ? node.id : firstLeafId(node.first)
}
