import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { prepareWorkspaceWatch } from '../../src/utils/prepareWorkspaceWatch'
import { useWorkspaceStore } from '../../src/stores/workspaceStore'
import { getActiveWorkspaceLifecycleKey } from '../../src/utils/workspaceOperationContext'

beforeEach(() => {
  useWorkspaceStore.setState({ activeWorkspaceId: 'startup', workspaces: [{ id: 'startup', name: 'Startup', primaryRoot: '/ws', lifecycleEpoch: 1 }], runtimes: {} })
  vi.stubGlobal('api', { watchFolder: vi.fn().mockResolvedValue({ success: true }), unwatchFolder: vi.fn().mockResolvedValue({ success: true }) })
})
afterEach(() => { vi.unstubAllGlobals() })

const lifecycle = () => getActiveWorkspaceLifecycleKey()!

describe('prepareWorkspaceWatch', () => {
  it('只合并相同上下文的在途注册，完成后不缓存成功', async () => {
    let finish!: () => void
    vi.mocked(window.api.watchFolder).mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve({ success: true }) }))
    const first = prepareWorkspaceWatch(lifecycle())
    const second = prepareWorkspaceWatch(lifecycle())
    expect(second).toBe(first)
    await vi.waitFor(() => expect(window.api.watchFolder).toHaveBeenCalledTimes(1))
    finish()
    await first
    await window.api.unwatchFolder('startup', 1)
    await prepareWorkspaceWatch(lifecycle())
    expect(window.api.watchFolder).toHaveBeenCalledTimes(2)
  })

  it.each(['workspace', 'epoch', 'root'])('不将%s变化后的注册合并给旧上下文', async change => {
    let finish!: () => void
    vi.mocked(window.api.watchFolder).mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve({ success: true }) }))
    const first = prepareWorkspaceWatch(lifecycle())
    await vi.waitFor(() => expect(window.api.watchFolder).toHaveBeenCalledTimes(1))
    useWorkspaceStore.setState({ activeWorkspaceId: change === 'workspace' ? 'next' : 'startup', workspaces: [{ id: change === 'workspace' ? 'next' : 'startup', name: 'Next', primaryRoot: change === 'root' ? '/other' : '/ws', lifecycleEpoch: change === 'epoch' ? 2 : 1 }] })
    await prepareWorkspaceWatch(lifecycle())
    expect(window.api.watchFolder).toHaveBeenCalledTimes(2)
    finish()
    await first
  })

  it('调用前或提交前已失效的上下文不注册', async () => {
    const old = lifecycle()
    const pending = prepareWorkspaceWatch(old)
    useWorkspaceStore.setState({ activeWorkspaceId: null })
    await pending
    await prepareWorkspaceWatch(old)
    expect(window.api.watchFolder).not.toHaveBeenCalled()
  })

  it('没有主根时不建立监听', async () => {
    useWorkspaceStore.setState({ workspaces: [{ id: 'startup', name: 'Startup', primaryRoot: null, lifecycleEpoch: 1 }] })
    await prepareWorkspaceWatch(lifecycle())
    expect(window.api.watchFolder).not.toHaveBeenCalled()
  })

  it('失败后释放在途请求，不把失败缓存为准备完成', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(window.api.watchFolder).mockRejectedValueOnce(new Error('unavailable'))
    try {
      await prepareWorkspaceWatch(lifecycle())
      await prepareWorkspaceWatch(lifecycle())
      expect(window.api.watchFolder).toHaveBeenCalledTimes(2)
      expect(log).toHaveBeenCalledTimes(1)
    } finally { log.mockRestore() }
  })
})
