import { describe, expect, it } from 'vitest'
import { aggregateFileTreeMetadata, fileTreeMetadataPaths, retainFileTreeOrder, sortFileTree, type SortableTreeItem } from '../../src/utils/fileTreeSort'
import { DEFAULT_FILE_TREE_SORT, isFileTreeSort, normalizeFileTreeSort } from '../../../shared/fileTreeSort'

const file = (name: string) => ({ name, path: `/root/${name}`, treePath: name, isDirectory: false })
const folder = (name: string) => ({ ...file(name), isDirectory: true, children: [file('10.md'), file('2.md')] })
const items: SortableTreeItem[] = [folder('1'), folder('10'), folder('2'), file('1.md'), file('10.md'), file('2.md')]
const names = (tree: typeof items) => tree.map(item => item.name)

describe('file tree sorting', () => {
  it('keeps the existing default tree by reference and never mutates input', () => {
    expect(sortFileTree(items, DEFAULT_FILE_TREE_SORT)).toBe(items)
    const before = JSON.stringify(items)
    sortFileTree(items, { by: 'natural', direction: 'asc' })
    expect(JSON.stringify(items)).toBe(before)
  })
  it('sorts natural numbers recursively with directories first in either direction', () => {
    const tree = sortFileTree(items, { by: 'natural', direction: 'asc' })
    expect(names(tree)).toEqual(['1', '2', '10', '1.md', '2.md', '10.md'])
    expect(tree[0].children?.map(item => item.name)).toEqual(['2.md', '10.md'])
    expect(names(sortFileTree(items, { by: 'natural', direction: 'desc' })))
      .toEqual(['10', '2', '1', '10.md', '2.md', '1.md'])
    expect(names(sortFileTree(items, { by: 'name', direction: 'desc' })))
      .toEqual(['2', '10', '1', '2.md', '10.md', '1.md'])
  })
  it('sorts extensions case-insensitively and keeps natural tie order', () => {
    const tree = [file('10.MD'), folder('2'), file('a.excalidraw'), file('2.md'), folder('10')]
    expect(names(sortFileTree(tree, { by: 'type', direction: 'desc' })))
      .toEqual(['10', '2', '2.md', '10.MD', 'a.excalidraw'])
  })
  it('waits for a sibling group and puts failed metadata last in either direction', () => {
    const items = [file('1.md'), file('10.md'), file('2.md')]
    const metadata = { '1.md': { mtimeMs: 100, size: 20 }, '10.md': { mtimeMs: 200, size: 10 } }
    expect(sortFileTree(items, { by: 'modified', direction: 'desc' }, metadata)).toBe(items)
    const complete = { ...metadata, '2.md': null }
    expect(names(sortFileTree(items, { by: 'modified', direction: 'desc' }, complete)))
      .toEqual(['10.md', '1.md', '2.md'])
    expect(names(sortFileTree(items, { by: 'size', direction: 'asc' }, complete)))
      .toEqual(['10.md', '1.md', '2.md'])
    expect(names(sortFileTree(items, { by: 'size', direction: 'desc' }, complete)))
      .toEqual(['1.md', '10.md', '2.md'])
  })
  it('uses deterministic names for equal values, including non-ASCII names', () => {
    const tree = ['中10.md', '中2.md', '01.md', '1.md', 'A.md', 'a.md'].map(file)
    const data = Object.fromEntries(tree.map(item => [item.treePath, { mtimeMs: 10, size: 10 }]))
    const sorted = sortFileTree(tree, { by: 'size', direction: 'desc' }, data)
    expect(names(sortFileTree([...tree].reverse(), { by: 'size', direction: 'asc' }, data))).toEqual(names(sorted))
    expect(names(sorted).indexOf('中2.md')).toBeLessThan(names(sorted).indexOf('中10.md'))
  })
  it('validates settings without accepting partial or extra properties', () => {
    expect(isFileTreeSort({ by: 'size', direction: 'desc' })).toBe(true)
    for (const value of [null, [], {}, { by: 'size' }, { by: 'size', direction: 'bad' }, { by: 'size', direction: 'asc', root: '/' }]) {
      expect(isFileTreeSort(value)).toBe(false)
      expect(normalizeFileTreeSort(value)).toEqual(DEFAULT_FILE_TREE_SORT)
    }
  })
})


const directory = (name: string, children: SortableTreeItem[] = []): SortableTreeItem => ({ ...file(name), isDirectory: true, children })
const nested: SortableTreeItem[] = [
  directory('A', [directory('A/sub1', [file('A/sub1/a.md')]), directory('A/sub2', [file('A/sub2/a.md')]), file('A/a.md')]),
  directory('B', [file('B/small.md'), file('B/large.md')]), file('root10.md'), file('root2.md'),
]
const attributes = {
  'A/sub1/a.md': { size: 5, mtimeMs: 100 }, 'A/sub2/a.md': { size: 7, mtimeMs: 150 }, 'A/a.md': { size: 3, mtimeMs: 90 },
  'B/small.md': { size: 1, mtimeMs: 10 }, 'B/large.md': { size: 29, mtimeMs: 300 },
  'root10.md': { size: 10, mtimeMs: 200 }, 'root2.md': { size: 20, mtimeMs: 250 },
}

describe('folder metadata and pending order', () => {
  it('aggregates all descendants once and sorts both groups at every depth', () => {
    const before = JSON.stringify(nested)
    const metadata = aggregateFileTreeMetadata(nested, attributes)
    expect(metadata.A).toEqual({ size: 15, mtimeMs: 150 })
    expect(metadata.B).toEqual({ size: 30, mtimeMs: 300 })
    expect(metadata['A/sub2']).toEqual({ size: 7, mtimeMs: 150 })
    for (const by of ['size', 'modified'] as const) {
      const descending = sortFileTree(nested, { by, direction: 'desc' }, metadata)
      expect(names(descending)).toEqual(['B', 'A', 'root2.md', 'root10.md'])
      expect(names(descending[1].children!)).toEqual(['A/sub2', 'A/sub1', 'A/a.md'])
      const ascending = sortFileTree(nested, { by, direction: 'asc' }, metadata)
      expect(names(ascending)).toEqual(['A', 'B', 'root10.md', 'root2.md'])
      expect(names(ascending[0].children!)).toEqual(['A/sub1', 'A/sub2', 'A/a.md'])
    }
    expect(JSON.stringify(nested)).toBe(before)
    expect(fileTreeMetadataPaths(nested)).toHaveLength(7)
  })
  it('uses full-tree folder values even when a filter hides the large document', () => {
    const filtered = [nested[0], { ...nested[1], children: [file('B/small.md')] }]
    const metadata = aggregateFileTreeMetadata(nested, attributes)
    expect(names(sortFileTree(filtered, { by: 'size', direction: 'desc' }, metadata))).toEqual(['B', 'A'])
  })
  it('keeps unfinished totals absent and makes failed ancestors unavailable', () => {
    const incomplete = aggregateFileTreeMetadata(nested, { 'A/a.md': attributes['A/a.md'] })
    expect(Object.hasOwn(incomplete, 'A')).toBe(false)
    const complete = aggregateFileTreeMetadata(nested, { ...attributes, 'B/large.md': null })
    expect(complete.B).toBeNull()
    for (const direction of ['asc', 'desc'] as const) {
      expect(names(sortFileTree(nested, { by: 'size', direction }, complete)).slice(0, 2)).toEqual(['A', 'B'])
    }
  })
  it('defines empty size as zero but never invents an empty modification time', () => {
    const tree = [directory('empty'), directory('full', [file('full/a.md')])]
    const data = aggregateFileTreeMetadata(tree, { 'full/a.md': { size: 1, mtimeMs: -10 } })
    expect(data.empty).toEqual({ size: 0, mtimeMs: null })
    expect(names(sortFileTree(tree, { by: 'size', direction: 'asc' }, data))).toEqual(['empty', 'full'])
    for (const direction of ['asc', 'desc'] as const) {
      expect(names(sortFileTree(tree, { by: 'modified', direction }, data))).toEqual(['full', 'empty'])
    }
  })
  it('rejects unsafe totals and handles prototype-like directory names as ordinary keys', () => {
    const tree = [directory('__proto__', [file('a.md'), file('b.md')]), directory('constructor')]
    const data = aggregateFileTreeMetadata(tree, { 'a.md': { size: Number.MAX_SAFE_INTEGER, mtimeMs: 1 }, 'b.md': { size: 1, mtimeMs: 2 } })
    expect(Object.getPrototypeOf(data)).toBeNull()
    expect(Object.hasOwn(data, '__proto__')).toBe(true)
    expect(data.__proto__).toBeNull()
    expect(data.constructor).toEqual({ size: 0, mtimeMs: null })
  })
  it('retains positions but immediately uses fresh nodes, removes old ones and appends new siblings', () => {
    const previous: SortableTreeItem[] = [directory('B', [file('B/2.md'), file('B/1.md')]), directory('A'), file('2.md'), file('1.md')]
    const updated = { ...file('2.md'), name: 'fresh label' }
    const current: SortableTreeItem[] = [directory('A'), directory('B', [file('B/1.md'), file('B/new.md')]), directory('C'), file('0.md'), updated]
    const ordered = retainFileTreeOrder(current, previous)
    expect(names(ordered)).toEqual(['B', 'A', 'C', 'fresh label', '0.md'])
    expect(ordered[3]).toBe(updated)
    expect(names(ordered[0].children!)).toEqual(['B/1.md', 'B/new.md'])
    expect(retainFileTreeOrder(ordered, ordered)).toBe(ordered)
  })
})
