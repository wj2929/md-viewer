import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useFolderHistorySearch } from '../../src/hooks/useFolderHistorySearch'
import { useFolderSearchSettingsStore as store } from '../../src/stores/folderSearchSettingsStore'

const dictionary = vi.hoisted(() => {
  let release!: () => void
  const ready = new Promise<void>(resolve => { release = resolve })
  return {
    ready, release, imported: vi.fn(),
    indexFolderName: vi.fn(() => ({ allChinese: true, segments: [{ atStart: true, text: 'yanfazhongxin', boundaries: [0, 3, 5, 10, 13] }] })),
  }
})
vi.mock('../../src/utils/folderNamePinyin', async () => {
  dictionary.imported()
  await dictionary.ready
  return { indexFolderName: dictionary.indexFolderName }
})

describe('useFolderHistorySearch 异步隔离', () => {
  it('关闭时不加载，加载中查询/IME/开关变化不闪现旧结果；改名移除使缓存失效', async () => {
    const history = [{ id: 'h1', name: '研发中心', path: '/fixture/root' }]
    window.api = { ...window.api, getAppSettings: vi.fn().mockResolvedValue({}), updateAppSettings: vi.fn().mockResolvedValue(undefined) }
    store.setState({ hydration: 'idle', enabled: false, pending: null, saving: false, hasLoaded: false, error: null, revision: 0 })
    const empty = [] as typeof history
    const { result, rerender, unmount } = renderHook(props => useFolderHistorySearch(props), {
      initialProps: { open: true, query: 'yanfa', history, directMatches: empty, composing: false },
    })
    await waitFor(() => expect(store.getState().hydration).toBe('ready'))
    expect(dictionary.imported).not.toHaveBeenCalled()
    expect(dictionary.indexFolderName).not.toHaveBeenCalled()
    await act(async () => { await store.getState().setEnabled(true) })
    await waitFor(() => expect(result.current.loading).toBe(true))
    rerender({ open: true, query: 'anfa', history, directMatches: empty, composing: false })
    expect(result.current.pinyin).toEqual([])
    await act(async () => { await store.getState().setEnabled(false) })
    await act(async () => { dictionary.release(); await dictionary.ready })
    expect(result.current.pinyin).toEqual([])
    expect(dictionary.indexFolderName).not.toHaveBeenCalled()
    rerender({ open: true, query: 'yanfa', history, directMatches: empty, composing: true })
    await act(async () => { await store.getState().setEnabled(true) })
    expect(dictionary.indexFolderName).not.toHaveBeenCalled()
    rerender({ open: true, query: 'yanfa', history, directMatches: empty, composing: false })
    await waitFor(() => expect(result.current.pinyin).toEqual(history))
    expect(dictionary.indexFolderName).toHaveBeenCalledTimes(1)
    rerender({ open: true, query: 'zhongxin', history, directMatches: empty, composing: false })
    expect(result.current.pinyin).toEqual([])
    await waitFor(() => expect(result.current.pinyin).toEqual(history))
    expect(dictionary.indexFolderName).toHaveBeenCalledTimes(1)
    rerender({ open: true, query: 'yan', history, directMatches: empty, composing: false })
    expect(result.current.pinyin).toEqual([])
    await waitFor(() => expect(result.current.pinyin).toEqual(history))
    rerender({ open: true, query: 'yanf', history, directMatches: empty, composing: true })
    expect(result.current.pinyin).toEqual([])
    rerender({ open: true, query: 'yanf', history, directMatches: empty, composing: false })
    await waitFor(() => expect(result.current.pinyin).toEqual(history))
    expect(dictionary.indexFolderName).toHaveBeenCalledTimes(1)
    const renamed = [{ ...history[0], name: '研发中心改名' }]
    rerender({ open: true, query: 'yanfa', history: renamed, directMatches: empty, composing: false })
    await waitFor(() => expect(dictionary.indexFolderName).toHaveBeenCalledWith('研发中心改名'))
    rerender({ open: false, query: 'yanfa', history: renamed, directMatches: empty, composing: false })
    expect(result.current.pinyin).toEqual([])
    unmount()
  })
})
