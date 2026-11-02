import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useFileTreeSortMetadata } from '../../src/hooks/useFileTreeSortMetadata'
import { useWorkspaceStore } from '../../src/stores/workspaceStore'
import { useFileStore } from '../../src/stores/fileStore'
import type { FileTreeMetadataResult } from '../../../shared/fileTreeSort'

const file = (treePath: string) => ({ treePath, name: treePath, path: `/root/${treePath}`, isDirectory: false })
const tree = [file('a.md'), { treePath: 'closed', name: 'closed', path: '/root/closed', isDirectory: true, children: [file('closed/b.md')] }]
const readResult = (paths: string[]): FileTreeMetadataResult[] => paths.map(relativePath => ({ relativePath, value: { size: 10, mtimeMs: 100 } }))

describe('file tree metadata lifecycle', () => {
  let change: (event: { workspaceId: string; lifecycleEpoch: number; path?: string }) => void
  beforeEach(() => {
    useWorkspaceStore.setState({ activeWorkspaceId: 'w', workspaces: [{ id: 'w', primaryRoot: '/root', lifecycleEpoch: 1, name: 'root' }] })
    useFileStore.setState({ treeMetadataRefresh: 0 })
    window.api = {
      getFileTreeMetadata: vi.fn(async paths => readResult(paths)),
      onFileChanged: vi.fn(callback => { change = callback; return vi.fn() }),
    } as unknown as Window['api']
  })
  it('does no IO in name mode, includes collapsed descendants and reuses metadata on rerender', async () => {
    const { result, rerender } = renderHook(({ enabled }) => useFileTreeSortMetadata(tree, '/root', enabled), { initialProps: { enabled: false } })
    expect(window.api.getFileTreeMetadata).not.toHaveBeenCalled()
    rerender({ enabled: true })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(window.api.getFileTreeMetadata).toHaveBeenCalledTimes(1)
    expect(vi.mocked(window.api.getFileTreeMetadata).mock.calls[0][0]).toEqual(['a.md', 'closed/b.md'])
    rerender({ enabled: true })
    expect(window.api.getFileTreeMetadata).toHaveBeenCalledTimes(1)
  })
  it('reads only newly added paths without rereading existing descendants', async () => {
    const { result, rerender } = renderHook(({ items }) => useFileTreeSortMetadata(items, '/root', true), { initialProps: { items: tree } })
    await waitFor(() => expect(result.current.ready).toBe(true))
    rerender({ items: [...tree, file('new.md')] })
    expect(result.current.ready).toBe(false)
    await waitFor(() => expect(result.current.metadata['new.md']).toBeTruthy())
    expect(vi.mocked(window.api.getFileTreeMetadata).mock.calls.map(call => call[0])).toEqual([['a.md', 'closed/b.md'], ['new.md']])
  })
  it('batches a large sibling group without overlapping requests', async () => {
    const many = Array.from({ length: 600 }, (_, i) => file(`${i}.md`))
    const { result } = renderHook(() => useFileTreeSortMetadata(many, '/root', true))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(vi.mocked(window.api.getFileTreeMetadata).mock.calls.map(call => call[0].length)).toEqual([256, 256, 88])
  })
  it('discards a result if a change arrived during the read, then rereads the file', async () => {
    let resolve!: (value: FileTreeMetadataResult[]) => void
    vi.mocked(window.api.getFileTreeMetadata).mockImplementationOnce(() => new Promise(yes => { resolve = yes }))
    const { result } = renderHook(() => useFileTreeSortMetadata(tree, '/root', true))
    act(() => change({ workspaceId: 'w', lifecycleEpoch: 1, path: '/root/a.md' }))
    await act(async () => resolve([{ relativePath: 'a.md', value: { size: 999, mtimeMs: 1 } }, ...readResult(['closed/b.md'])]))
    await waitFor(() => expect(result.current.metadata['a.md']?.size).toBe(10))
    expect(window.api.getFileTreeMetadata).toHaveBeenCalledTimes(2)
  })
  it('ignores another workspace events and rereads requested files on explicit refresh', async () => {
    const { result } = renderHook(() => useFileTreeSortMetadata(tree, '/root', true))
    await waitFor(() => expect(result.current.loading).toBe(false))
    act(() => change({ workspaceId: 'other', lifecycleEpoch: 1, path: '/root/a.md' }))
    expect(window.api.getFileTreeMetadata).toHaveBeenCalledTimes(1)
    act(() => useFileStore.getState().refreshTreeMetadata())
    await waitFor(() => expect(window.api.getFileTreeMetadata).toHaveBeenCalledTimes(2))
  })
  it('does not apply late data after switching away from attribute sorting', async () => {
    let resolve!: (value: FileTreeMetadataResult[]) => void
    vi.mocked(window.api.getFileTreeMetadata).mockImplementationOnce(() => new Promise(yes => { resolve = yes }))
    const { result, rerender } = renderHook(({ enabled }) => useFileTreeSortMetadata(tree, '/root', enabled), { initialProps: { enabled: true } })
    rerender({ enabled: false })
    await act(async () => resolve(readResult(['a.md'])))
    expect(result.current.metadata).toEqual({})
    expect(result.current.loading).toBe(false)
  })
  it('does not reread when rendering or filtering rebuilds the same full-tree paths', async () => {
    const { result, rerender } = renderHook(({ items }) => useFileTreeSortMetadata(items, '/root', true), { initialProps: { items: tree } })
    await waitFor(() => expect(result.current.ready).toBe(true))
    const snapshot = result.current.metadata
    rerender({ items: [...tree] })
    expect(result.current.metadata).toBe(snapshot)
    expect(window.api.getFileTreeMetadata).toHaveBeenCalledTimes(1)
  })
  it('discards an old-root result without contaminating a new workspace', async () => {
    let resolve!: (value: FileTreeMetadataResult[]) => void
    vi.mocked(window.api.getFileTreeMetadata).mockImplementationOnce(() => new Promise(yes => { resolve = yes }))
    const { result, rerender } = renderHook(({ root }) => useFileTreeSortMetadata(tree, root, true), { initialProps: { root: '/root' } })
    act(() => useWorkspaceStore.setState({ activeWorkspaceId: 'new', workspaces: [{ id: 'new', primaryRoot: '/next', lifecycleEpoch: 2, name: 'next' }] }))
    rerender({ root: '/next' })
    await act(async () => resolve([{ relativePath: 'a.md', value: { size: 999, mtimeMs: 1 } }, ...readResult(['closed/b.md'])]))
    await waitFor(() => expect(result.current.metadata['a.md']?.size).toBe(10))
    expect(vi.mocked(window.api.getFileTreeMetadata).mock.calls[1][1].workspaceId).toBe('new')
  })

  it('shares the pending batch across tree unmount and remount', async () => {
    let resolve!: (value: FileTreeMetadataResult[]) => void
    vi.mocked(window.api.getFileTreeMetadata).mockImplementationOnce(() => new Promise(yes => { resolve = yes }))
    const first = renderHook(() => useFileTreeSortMetadata(tree, '/root', true))
    expect(window.api.getFileTreeMetadata).toHaveBeenCalledTimes(1)
    first.unmount()
    const second = renderHook(() => useFileTreeSortMetadata(tree, '/root', true))
    expect(window.api.getFileTreeMetadata).toHaveBeenCalledTimes(1)
    await act(async () => resolve(readResult(['a.md'])))
    await waitFor(() => expect(second.result.current.loading).toBe(false))
    expect(window.api.getFileTreeMetadata).toHaveBeenCalledTimes(2)
    expect(second.result.current.error).toBeNull()
  })

  it('keeps read failure explicit and retries without deleting nodes', async () => {
    vi.mocked(window.api.getFileTreeMetadata).mockRejectedValueOnce(new Error('disk'))
    const { result } = renderHook(() => useFileTreeSortMetadata(tree, '/root', true))
    await waitFor(() => expect(result.current.error).toContain('读取失败'))
    expect(result.current.metadata).toEqual({})
    act(() => result.current.retry())
    await waitFor(() => expect(result.current.metadata['a.md']).toBeTruthy())
    expect(result.current.error).toBeNull()
  })
  it('publishes only once all batches and invalidated versions are complete', async () => {
    const pending: Array<{ paths: string[]; resolve: (value: FileTreeMetadataResult[]) => void }> = []
    vi.mocked(window.api.getFileTreeMetadata).mockImplementation(paths => new Promise(resolve => pending.push({ paths, resolve })))
    const many = Array.from({ length: 257 }, (_, i) => file(`${i}.md`))
    const { result } = renderHook(() => useFileTreeSortMetadata(many, '/root', true))
    await act(async () => pending[0].resolve(readResult(pending[0].paths)))
    await waitFor(() => expect(pending).toHaveLength(2))
    expect(result.current.metadata).toEqual({})
    expect(result.current.ready).toBe(false)
    await act(async () => {
      pending[1].resolve(readResult(pending[1].paths))
      change({ workspaceId: 'w', lifecycleEpoch: 1, path: '/root/0.md' })
    })
    await waitFor(() => expect(pending).toHaveLength(3))
    expect(pending[2].paths).toEqual(['0.md'])
    expect(result.current.metadata).toEqual({})
    await act(async () => pending[2].resolve([{ relativePath: '0.md', value: { size: 20, mtimeMs: 200 } }]))
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(Object.keys(result.current.metadata)).toHaveLength(257)
    expect(result.current.metadata['0.md']?.size).toBe(20)
  })
  it('retains the published snapshot while refreshing only the changed document', async () => {
    const { result } = renderHook(() => useFileTreeSortMetadata(tree, '/root', true))
    await waitFor(() => expect(result.current.ready).toBe(true))
    const previous = result.current.metadata
    let resolve!: (value: FileTreeMetadataResult[]) => void
    vi.mocked(window.api.getFileTreeMetadata).mockImplementationOnce(() => new Promise(yes => { resolve = yes }))
    act(() => change({ workspaceId: 'w', lifecycleEpoch: 1, path: '/root/closed/b.md' }))
    await waitFor(() => expect(window.api.getFileTreeMetadata).toHaveBeenCalledTimes(2))
    expect(result.current.ready).toBe(false)
    expect(result.current.metadata).toBe(previous)
    expect(vi.mocked(window.api.getFileTreeMetadata).mock.calls[1][0]).toEqual(['closed/b.md'])
    await act(async () => resolve([{ relativePath: 'closed/b.md', value: { size: 30, mtimeMs: 300 } }]))
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.metadata['closed/b.md']?.size).toBe(30)
    expect(result.current.metadata['a.md']).toEqual(previous['a.md'])
  })
  it('does not accept a pre-deactivation result after quickly reentering attribute mode', async () => {
    let resolve!: (value: FileTreeMetadataResult[]) => void
    vi.mocked(window.api.getFileTreeMetadata).mockImplementationOnce(() => new Promise(yes => { resolve = yes }))
    const { result, rerender } = renderHook(({ enabled }) => useFileTreeSortMetadata(tree, '/root', enabled), { initialProps: { enabled: true } })
    rerender({ enabled: false })
    rerender({ enabled: true })
    await act(async () => resolve(readResult(['a.md', 'closed/b.md']).map(row => ({ ...row, value: { size: 999, mtimeMs: 999 } }))))
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.metadata['a.md']?.size).toBe(10)
    expect(window.api.getFileTreeMetadata).toHaveBeenCalledTimes(2)
  })
  it('prunes removed paths even if their old request completes later', async () => {
    let resolve!: (value: FileTreeMetadataResult[]) => void
    vi.mocked(window.api.getFileTreeMetadata).mockImplementationOnce(() => new Promise(yes => { resolve = yes }))
    const { result, rerender } = renderHook(({ items }) => useFileTreeSortMetadata(items, '/root', true), { initialProps: { items: tree } })
    rerender({ items: [tree[0]] })
    await act(async () => resolve(readResult(['a.md', 'closed/b.md'])))
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(Object.keys(result.current.metadata)).toEqual(['a.md'])
    expect(window.api.getFileTreeMetadata).toHaveBeenCalledTimes(1)
  })
  it('publishes a failed value without treating it as zero and retries only that path', async () => {
    vi.mocked(window.api.getFileTreeMetadata).mockResolvedValueOnce([{ relativePath: 'a.md', value: null }, ...readResult(['closed/b.md'])])
    const { result } = renderHook(() => useFileTreeSortMetadata(tree, '/root', true))
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.metadata['a.md']).toBeNull()
    expect(result.current.error).toContain('无法完整统计')
    act(() => result.current.retry())
    await waitFor(() => expect(result.current.error).toBeNull())
    expect(vi.mocked(window.api.getFileTreeMetadata).mock.calls[1][0]).toEqual(['a.md'])
  })
  it('ignores a rejected pre-deactivation request after reentering attribute mode', async () => {
    let reject!: (error: Error) => void
    vi.mocked(window.api.getFileTreeMetadata).mockImplementationOnce(() => new Promise((_yes, no) => { reject = no }))
    const { result, rerender } = renderHook(({ enabled }) => useFileTreeSortMetadata(tree, '/root', enabled), { initialProps: { enabled: true } })
    rerender({ enabled: false })
    rerender({ enabled: true })
    await act(async () => reject(new Error('stale request failed')))
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.error).toBeNull()
    expect(window.api.getFileTreeMetadata).toHaveBeenCalledTimes(2)
  })

})
