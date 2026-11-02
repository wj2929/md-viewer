import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock fileCache：控制读盘结果与调用计数
const readPreviewContentWithCache = vi.fn()
vi.mock('../../src/utils/fileCache', () => ({
  readPreviewContentWithCache: (...args: unknown[]) => readPreviewContentWithCache(...args)
}))

const { ensureTabContentLoaded, invalidateTabContentLoad } = await import('../../src/utils/ensureTabContentLoaded')
const { useTabStore } = await import('../../src/stores/tabStore')
const { registerLinkedDocumentReader } = await import('../../src/utils/tabDocumentReader')
let unregisterReader: (() => void) | undefined

function makeTab(id: string, path: string, content: string | null) {
  return {
    id,
    file: { name: path.split('/').pop() || '', path, isDirectory: false },
    content,
    isPinned: false
  } as any
}

describe('ensureTabContentLoaded 懒加载工具', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('api', { getReadPosition: vi.fn().mockResolvedValue(null), saveReadPosition: vi.fn() })
    useTabStore.setState({ tabs: [], activeTabId: null } as any)
  })

  afterEach(() => {
    unregisterReader?.()
    unregisterReader = undefined
    vi.unstubAllGlobals()
    useTabStore.setState({ tabs: [], activeTabId: null } as any)
  })

  it('content 已加载时不读盘，直接返回', async () => {
    useTabStore.setState({ tabs: [makeTab('t1', '/ws/a.md', '# 已加载')] } as any)
    await ensureTabContentLoaded('t1')
    expect(readPreviewContentWithCache).not.toHaveBeenCalled()
  })

  it('壳 tab（content=null）读盘后写回内容', async () => {
    readPreviewContentWithCache.mockResolvedValue('# 磁盘内容')
    useTabStore.setState({ tabs: [makeTab('t1', '/ws/a.md', null)] } as any)

    await ensureTabContentLoaded('t1')

    expect(readPreviewContentWithCache).toHaveBeenCalledWith(
      '/ws/a.md',
      true,
      expect.objectContaining({ context: expect.objectContaining({ source: 'restore' }) }),
    )
    expect(useTabStore.getState().tabs.find(t => t.id === 't1')?.content).toBe('# 磁盘内容')
  })

  it('并发调用去重，只读盘一次', async () => {
    let resolveRead: (v: string) => void = () => {}
    readPreviewContentWithCache.mockImplementation(() => new Promise<string>(res => { resolveRead = res }))
    useTabStore.setState({ tabs: [makeTab('t1', '/ws/a.md', null)] } as any)

    const p1 = ensureTabContentLoaded('t1')
    const p2 = ensureTabContentLoaded('t1')
    expect(p1).toBe(p2)

    resolveRead('# 内容')
    await Promise.all([p1, p2])
    expect(readPreviewContentWithCache).toHaveBeenCalledTimes(1)
  })

  it('路径变化后丢弃旧读取结果，并读取新路径最新内容', async () => {
    let resolveOld: (value: string) => void = () => {}
    readPreviewContentWithCache
      .mockImplementationOnce(() => new Promise<string>(resolve => { resolveOld = resolve }))
      .mockResolvedValueOnce('# 新路径内容')
    useTabStore.setState({ tabs: [makeTab('t1', '/ws/old.md', null)] } as any)

    const loading = ensureTabContentLoaded('t1')
    useTabStore.setState({
      tabs: [makeTab('t1', '/ws/new.md', null)]
    } as any)
    invalidateTabContentLoad('t1')
    resolveOld('# 旧路径内容')
    await loading
    await vi.waitFor(() => {
      expect(useTabStore.getState().tabs.find(t => t.id === 't1')?.content).toBe('# 新路径内容')
    })

    expect(readPreviewContentWithCache).toHaveBeenNthCalledWith(
      1,
      '/ws/old.md',
      true,
      expect.objectContaining({ context: expect.objectContaining({ source: 'restore' }) }),
    )
    expect(readPreviewContentWithCache).toHaveBeenNthCalledWith(
      2,
      '/ws/new.md',
      true,
      expect.objectContaining({ context: expect.objectContaining({ source: 'restore' }) }),
    )
  })

  it('读盘失败时保持壳状态，允许后续重试', async () => {
    readPreviewContentWithCache
      .mockRejectedValueOnce(new Error('ENOENT'))
      .mockResolvedValueOnce('# 恢复内容')
    useTabStore.setState({ tabs: [makeTab('t1', '/ws/gone.md', null)] } as any)

    await ensureTabContentLoaded('t1')
    expect(useTabStore.getState().tabs.find(t => t.id === 't1')?.content).toBeNull()

    await ensureTabContentLoaded('t1')
    expect(useTabStore.getState().tabs.find(t => t.id === 't1')?.content).toBe('# 恢复内容')
  })

  it('外部许可缺失不fallback路径缓存，显示missing且不泄漏路径错误', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    useTabStore.setState({ tabs: [{ ...makeTab('external-missing', '/external/B.md', null), linkedReadOnly: true }] })
    await ensureTabContentLoaded('external-missing')
    expect(readPreviewContentWithCache).not.toHaveBeenCalled()
    expect(useTabStore.getState().tabs[0]).toMatchObject({ content: null, missing: true })
    expect(log).not.toHaveBeenCalled()
    log.mockRestore()
  })
  it('外部hydrate ABA旧请求失败后重试新代际，不永久保留加载壳', async () => {
    let rejectOld: (error: Error) => void = () => {}
    const reader = vi.fn().mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectOld = reject }))
      .mockResolvedValueOnce('# 新代际正文')
    unregisterReader = registerLinkedDocumentReader(reader)
    useTabStore.setState({ tabs: [{ ...makeTab('external-aba', '/external/B.md', null), linkedReadOnly: true }] })
    const old = ensureTabContentLoaded('external-aba')
    invalidateTabContentLoad('external-aba')
    rejectOld(new Error('stale'))
    await old
    await vi.waitFor(() => expect(useTabStore.getState().tabs[0].content).toBe('# 新代际正文'))
    expect(reader).toHaveBeenCalledTimes(2)
    expect(readPreviewContentWithCache).not.toHaveBeenCalled()
    expect(useTabStore.getState().tabs[0].missing).not.toBe(true)
  })
  it('懒加载内容与位置一起归属当前标签，不修改位置存储', async () => {
    readPreviewContentWithCache.mockResolvedValue('# 内容')
    vi.mocked(window.api.getReadPosition).mockResolvedValue({ canonicalPath: '/ws/a.md', scrollRatio: 0.57, updatedAt: 1 })
    useTabStore.setState({ tabs: [makeTab('position', '/ws/a.md', null)] })
    await ensureTabContentLoaded('position')
    expect(useTabStore.getState().tabs[0]).toMatchObject({ content: '# 内容', initialScrollRatio: 0.57 })
    expect(window.api.getReadPosition).toHaveBeenCalledWith('/ws/a.md')
  })

  it('迟到位置不能把已关闭标签的内容或位置写给新文档', async () => {
    readPreviewContentWithCache.mockResolvedValue('# 旧文档')
    let resolve!: (value: any) => void
    vi.mocked(window.api.getReadPosition).mockImplementationOnce(() => new Promise(done => { resolve = done }))
    useTabStore.setState({ tabs: [makeTab('old-position', '/ws/a.md', null)] })
    const pending = ensureTabContentLoaded('old-position')
    useTabStore.setState({ tabs: [makeTab('new-position', '/ws/b.md', '# 新文档')] })
    resolve({ scrollRatio: 0.8 })
    await pending
    expect(useTabStore.getState().tabs).toEqual([makeTab('new-position', '/ws/b.md', '# 新文档')])
  })

  it('位置读取失败不阻止内容恢复', async () => {
    readPreviewContentWithCache.mockResolvedValue('# 内容')
    vi.mocked(window.api.getReadPosition).mockRejectedValue(new Error('unavailable'))
    useTabStore.setState({ tabs: [makeTab('failed-position', '/ws/a.md', null)] })
    await ensureTabContentLoaded('failed-position')
    expect(useTabStore.getState().tabs[0]).toMatchObject({ content: '# 内容', initialScrollRatio: undefined })
  })

  it.each([NaN, Infinity, '0.5'])('不把无效比例%j传入视口', async ratio => {
    readPreviewContentWithCache.mockResolvedValue('# 内容')
    vi.mocked(window.api.getReadPosition).mockResolvedValue({ scrollRatio: ratio } as any)
    useTabStore.setState({ tabs: [makeTab('invalid-position', '/ws/a.md', null)] })
    await ensureTabContentLoaded('invalid-position')
    expect(useTabStore.getState().tabs[0].initialScrollRatio).toBeUndefined()
  })

  it('只读外部文档不读取或写入文件级阅读记录', async () => {
    unregisterReader = registerLinkedDocumentReader(vi.fn().mockResolvedValue('# 外部正文'))
    useTabStore.setState({ tabs: [{ ...makeTab('readonly-position', '/external/a.md', null), linkedReadOnly: true }] })
    await ensureTabContentLoaded('readonly-position')
    expect(window.api.getReadPosition).not.toHaveBeenCalled()
    expect(window.api.saveReadPosition).not.toHaveBeenCalled()
    expect(useTabStore.getState().tabs[0].initialScrollRatio).toBeUndefined()
  })

  it('同路径新代际不接收迟到旧位置，重新读取当前记录', async () => {
    readPreviewContentWithCache.mockResolvedValue('# 内容')
    let resolve!: (value: any) => void
    vi.mocked(window.api.getReadPosition)
      .mockImplementationOnce(() => new Promise(done => { resolve = done }))
      .mockResolvedValueOnce({ canonicalPath: '/ws/a.md', scrollRatio: 0.2, updatedAt: 2 })
    useTabStore.setState({ tabs: [makeTab('position-aba', '/ws/a.md', null)] })
    const pending = ensureTabContentLoaded('position-aba')
    invalidateTabContentLoad('position-aba')
    useTabStore.setState({ tabs: [makeTab('position-aba', '/ws/a.md', null)] })
    resolve({ scrollRatio: 0.8 })
    await pending
    await vi.waitFor(() => expect(useTabStore.getState().tabs[0].initialScrollRatio).toBe(0.2))
    expect(window.api.getReadPosition).toHaveBeenCalledTimes(2)
    expect(window.api.saveReadPosition).not.toHaveBeenCalled()
  })

  it.each([[-1, 0], [2, 1]])('比例%j限制为%j', async (ratio, expected) => {
    readPreviewContentWithCache.mockResolvedValue('# 内容')
    vi.mocked(window.api.getReadPosition).mockResolvedValue({ scrollRatio: ratio } as any)
    useTabStore.setState({ tabs: [makeTab('clamped-position', '/ws/a.md', null)] })
    await ensureTabContentLoaded('clamped-position')
    expect(useTabStore.getState().tabs[0].initialScrollRatio).toBe(expected)
  })

  it('未知 tabId 直接返回，不读盘', async () => {
    await ensureTabContentLoaded('missing')
    expect(readPreviewContentWithCache).not.toHaveBeenCalled()
  })
})
