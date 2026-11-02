import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useFolderHistorySearch } from '../../src/hooks/useFolderHistorySearch'
import { useFolderSearchSettingsStore as store } from '../../src/stores/folderSearchSettingsStore'

const failure = vi.hoisted(() => ({ loads: vi.fn() }))
vi.mock('../../src/utils/folderNamePinyin', () => {
  failure.loads()
  throw new Error('fixture dictionary unavailable')
})

describe('拼音模块加载失败', () => {
  it('不伪装为无匹配、不随输入反复重试，关闭重开后允许重试', async () => {
    const history = [{ id: 'h1', name: '研发中心', path: '/fixture/root' }]
    window.api = { ...window.api, getAppSettings: vi.fn().mockResolvedValue({ folderPinyinSearchEnabled: true }) }
    store.setState({ hydration: 'idle', enabled: false, pending: null, saving: false, hasLoaded: false, error: null, revision: 0 })
    const empty = [] as typeof history
    const props = { open: true, query: 'yanfa', history, directMatches: empty, composing: false }
    const { result, rerender } = renderHook(value => useFolderHistorySearch(value), { initialProps: props })
    await waitFor(() => expect(result.current.error).toContain('拼音补充暂不可用'))
    expect(result.current.showHint).toBe(false)
    expect(result.current.loading).toBe(false)
    rerender({ ...props, query: 'zhongxin' })
    await waitFor(() => expect(result.current.error).toContain('拼音补充暂不可用'))
    expect(failure.loads).toHaveBeenCalledTimes(1)
    await act(async () => { rerender({ ...props, open: false }) })
    rerender(props)
    await waitFor(() => expect(result.current.error).toContain('拼音补充暂不可用'))
  })
})
