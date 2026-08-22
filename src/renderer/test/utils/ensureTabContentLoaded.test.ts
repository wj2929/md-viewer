import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock fileCache：控制读盘结果与调用计数
const readPreviewContentWithCache = vi.fn()
vi.mock('../../src/utils/fileCache', () => ({
  readPreviewContentWithCache: (...args: unknown[]) => readPreviewContentWithCache(...args)
}))

const { ensureTabContentLoaded } = await import('../../src/utils/ensureTabContentLoaded')
const { useTabStore } = await import('../../src/stores/tabStore')

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
    useTabStore.setState({ tabs: [], activeTabId: null } as any)
  })

  afterEach(() => {
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

    expect(readPreviewContentWithCache).toHaveBeenCalledWith('/ws/a.md')
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

  it('读盘失败时置空串占位，避免死循环', async () => {
    readPreviewContentWithCache.mockRejectedValue(new Error('ENOENT'))
    useTabStore.setState({ tabs: [makeTab('t1', '/ws/gone.md', null)] } as any)

    await ensureTabContentLoaded('t1')

    expect(useTabStore.getState().tabs.find(t => t.id === 't1')?.content).toBe('')
  })

  it('未知 tabId 直接返回，不读盘', async () => {
    await ensureTabContentLoaded('missing')
    expect(readPreviewContentWithCache).not.toHaveBeenCalled()
  })
})
