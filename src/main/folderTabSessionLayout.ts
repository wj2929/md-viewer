import type {
  FolderSplitLayoutV1,
  FolderSplitLeafViewState,
  PersistedFolderSplitNode,
} from '../shared/folderTabSession'

const MAX_SPLIT_DEPTH = 4
const MAX_HEADING_ID_LENGTH = 512
const MAX_CONTENT_HASH_LENGTH = 256

interface SanitizedNode {
  node: PersistedFolderSplitNode
  activePath: number[] | null
}

export function sanitizeFolderSplitLayout(
  value: unknown,
  validRelativePaths: ReadonlySet<string>,
): FolderSplitLayoutV1 | undefined {
  if (!value || typeof value !== 'object') return undefined
  const layout = value as Record<string, unknown>
  if (layout.version !== 1) return undefined

  const requestedActivePath = sanitizeRequestedActivePath(layout.activeLeafPath)
  const result = sanitizeNode(layout.root, 1, [], requestedActivePath, validRelativePaths)
  if (!result) return undefined
  return { version: 1, root: result.node, activeLeafPath: result.activePath }
}

function sanitizeNode(
  value: unknown,
  depth: number,
  sourcePath: number[],
  requestedActivePath: number[] | null,
  validRelativePaths: ReadonlySet<string>,
): SanitizedNode | null {
  if (!value || typeof value !== 'object' || depth > MAX_SPLIT_DEPTH) return null
  const node = value as Record<string, unknown>

  if (node.type === 'leaf') {
    if (!isSafeRelativePath(node.relativePath) || !validRelativePaths.has(node.relativePath)) return null
    const viewState = sanitizeViewState(node.viewState)
    return {
      node: {
        type: 'leaf',
        relativePath: node.relativePath,
        ...(viewState ? { viewState } : {}),
      },
      activePath: pathsEqual(sourcePath, requestedActivePath) ? [] : null,
    }
  }

  if (
    node.type !== 'split' ||
    (node.direction !== 'horizontal' && node.direction !== 'vertical') ||
    typeof node.ratio !== 'number' ||
    !Number.isFinite(node.ratio) ||
    node.ratio < 0.15 ||
    node.ratio > 0.85
  ) return null

  const first = sanitizeNode(node.first, depth + 1, [...sourcePath, 0], requestedActivePath, validRelativePaths)
  const second = sanitizeNode(node.second, depth + 1, [...sourcePath, 1], requestedActivePath, validRelativePaths)
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

function sanitizeViewState(value: unknown): FolderSplitLeafViewState | undefined {
  if (!value || typeof value !== 'object') return undefined
  const source = value as Record<string, unknown>
  const viewState: FolderSplitLeafViewState = {}
  if (typeof source.scrollRatio === 'number' && Number.isFinite(source.scrollRatio)) {
    viewState.scrollRatio = Math.max(0, Math.min(1, source.scrollRatio))
  }
  if (typeof source.headingId === 'string' && source.headingId.trim()) {
    viewState.headingId = source.headingId.trim().slice(0, MAX_HEADING_ID_LENGTH)
  }
  if (typeof source.contentHash === 'string' && source.contentHash.trim()) {
    viewState.contentHash = source.contentHash.trim().slice(0, MAX_CONTENT_HASH_LENGTH)
  }
  return Object.keys(viewState).length > 0 ? viewState : undefined
}

function sanitizeRequestedActivePath(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length > MAX_SPLIT_DEPTH - 1) return null
  return value.every(segment => segment === 0 || segment === 1) ? value : null
}

function pathsEqual(left: readonly number[], right: readonly number[] | null): boolean {
  return Boolean(right && left.length === right.length && left.every((value, index) => value === right[index]))
}

function isSafeRelativePath(value: unknown): value is string {
  if (typeof value !== 'string' || !value || value.length > 4096) return false
  if (value.startsWith('/') || value.startsWith('\\') || /^[A-Za-z]:[\\/]/.test(value)) return false
  return !value.split(/[\\/]+/).includes('..')
}
