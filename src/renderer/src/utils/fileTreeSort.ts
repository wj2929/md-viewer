import { needsFileTreeMetadata, type FileTreeMetadataMap, type FileTreeSort } from '../../../shared/fileTreeSort'

export interface SortableTreeItem {
  name: string
  path: string
  treePath?: string
  isDirectory: boolean
  children?: SortableTreeItem[]
}

type SortMetadata = { mtimeMs: number | null; size: number }
export type FileTreeSortMetadataMap = Record<string, { mtimeMs: number | null; size: number | null } | null>

const natural = new Intl.Collator(undefined, { numeric: true })
const exactCompare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0
const compareName = (a: SortableTreeItem, b: SortableTreeItem): number =>
  natural.compare(a.name, b.name) || exactCompare(a.name, b.name) || exactCompare(a.treePath ?? a.path, b.treePath ?? b.path)
const extension = (name: string): string => name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : ''
const itemKey = (item: SortableTreeItem): string => item.treePath ?? item.path

// Use the complete, unfiltered tree; folders are derived values, never filesystem stat.size.
export function aggregateFileTreeMetadata(items: SortableTreeItem[], metadata: FileTreeMetadataMap): FileTreeSortMetadataMap {
  const result: FileTreeSortMetadataMap = Object.create(null)
  const visit = (item: SortableTreeItem): SortMetadata | null | undefined => {
    let value: SortMetadata | null | undefined
    if (!item.isDirectory) {
      if (item.treePath && Object.hasOwn(metadata, item.treePath)) {
        const info = metadata[item.treePath]
        value = info && Number.isFinite(info.mtimeMs) && Number.isSafeInteger(info.size) && info.size >= 0 ? info : null
      }
    } else {
      let size = 0
      let mtimeMs: number | null = null
      let pending = false
      let failed = false
      for (const child of item.children ?? []) {
        const info = visit(child)
        if (info === undefined) pending = true
        else if (info === null) failed = true
        else {
          size += info.size
          if (info.mtimeMs !== null) mtimeMs = mtimeMs === null ? info.mtimeMs : Math.max(mtimeMs, info.mtimeMs)
        }
      }
      value = pending ? undefined : failed || !Number.isSafeInteger(size) ? null : { mtimeMs, size }
    }
    if (item.treePath && value !== undefined) result[item.treePath] = value
    return value
  }
  items.forEach(visit)
  return result
}

export function sortFileTree<T extends SortableTreeItem>(
  items: T[], sort: FileTreeSort, metadata: FileTreeSortMetadataMap = {}, directorySizeByName = false,
): T[] {
  if (sort.by === 'name' && sort.direction === 'asc') return items
  const needsMetadata = needsFileTreeMetadata(sort.by)
  const ready = !needsMetadata || items.every(item => item.treePath && Object.hasOwn(metadata, item.treePath))
  const direction = sort.direction === 'asc' ? 1 : -1
  const ordered = ready ? [...items].sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
    if (sort.by === 'name') return a.name.localeCompare(b.name) * direction
    if (sort.by === 'natural') return compareName(a, b) * direction
    if (sort.by === 'type') return a.isDirectory ? compareName(a, b) * direction
      : extension(a.name).localeCompare(extension(b.name)) * direction || compareName(a, b)
    if (sort.by === 'size' && a.isDirectory && directorySizeByName) return compareName(a, b)
    const key = sort.by === 'modified' ? 'mtimeMs' : 'size'
    const av = metadata[a.treePath!]?.[key]
    const bv = metadata[b.treePath!]?.[key]
    if (av == null || bv == null) return av != null ? -1 : bv != null ? 1 : compareName(a, b)
    return (av - bv) * direction || compareName(a, b)
  }) : items
  let changed = ordered !== items
  const result = ordered.map(item => {
    if (!item.children) return item
    const children = sortFileTree(item.children, sort, metadata, directorySizeByName)
    if (children === item.children) return item
    changed = true
    return { ...item, children }
  })
  return changed ? result : items
}

// Retain only positions while attributes load: never retain removed or outdated nodes.
export function retainFileTreeOrder<T extends SortableTreeItem>(items: T[], previous: T[]): T[] {
  const old = new Map(previous.map((item, index) => [itemKey(item), { item, index }]))
  const ordered = [...items].sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
    return (old.get(itemKey(a))?.index ?? previous.length) - (old.get(itemKey(b))?.index ?? previous.length)
  })
  let changed = ordered.some((item, index) => item !== items[index])
  const result = ordered.map(item => {
    if (!item.children) return item
    const children = retainFileTreeOrder(item.children, old.get(itemKey(item))?.item.children ?? [])
    if (children === item.children) return item
    changed = true
    return { ...item, children }
  })
  return changed ? result : items
}

export function fileTreeMetadataPaths(items: SortableTreeItem[]): string[] {
  const paths = new Set<string>()
  const visit = (nodes: SortableTreeItem[]): void => {
    for (const item of nodes) {
      if (item.isDirectory) visit(item.children ?? [])
      else if (item.treePath) paths.add(item.treePath)
    }
  }
  visit(items)
  return [...paths]
}
