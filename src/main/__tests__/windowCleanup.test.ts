import { describe, expect, it, vi } from 'vitest'
import { cleanupWindowCapabilities } from '../windowCleanup'

describe('cleanupWindowCapabilities', () => {
  it('按窗口所有工作区清理 watcher、索引 consumer 和 capability owner', () => {
    const cleanup = vi.fn()
    const detach = vi.fn()
    const cleanupOwner = vi.fn()
    const ctx = {
      windowManager: {
        listWorkspaces: vi.fn(() => [
          { id: 'workspace-a', lifecycleEpoch: 4, primaryRoot: '/root/a' },
          { id: 'workspace-b', lifecycleEpoch: 7, primaryRoot: null },
        ]),
      },
      workspaceIndexService: { detach },
      linkRewritePlanner: { cleanupOwner },
    }

    cleanupWindowCapabilities(
      ctx as any,
      { id: 3, webContents: { id: 9 } },
      { cleanup },
    )

    expect(cleanup).toHaveBeenCalledWith(9)
    expect(detach).toHaveBeenCalledTimes(1)
    expect(detach).toHaveBeenCalledWith('/root/a', 'workspace:9:workspace-a')
    expect(cleanupOwner).toHaveBeenCalledTimes(2)
    expect(cleanupOwner).toHaveBeenNthCalledWith(1, '9:workspace-a:4')
    expect(cleanupOwner).toHaveBeenNthCalledWith(2, '9:workspace-b:7')
  })
})
