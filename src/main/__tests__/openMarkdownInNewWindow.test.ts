import { beforeEach, describe, expect, it, vi } from 'vitest'
import { openMarkdownInNewWindow } from '../openMarkdownInNewWindow'
import { activateFolderForWindow } from '../folderActivation'
import { validateSecurePathInBase } from '../security'
import * as fs from 'fs/promises'

vi.mock('../folderActivation', () => ({ activateFolderForWindow: vi.fn() }))
vi.mock('../security', () => ({ validateSecurePathInBase: vi.fn() }))
vi.mock('fs/promises', () => ({ stat: vi.fn() }))

describe('openMarkdownInNewWindow', () => {
  let pendingAction: (() => void | Promise<void>) | undefined
  let targetWindow: any
  let ctx: any

  beforeEach(() => {
    vi.clearAllMocks()
    pendingAction = undefined
    targetWindow = {
      id: 2,
      isDestroyed: vi.fn(() => false),
      close: vi.fn(),
      webContents: {
        isDestroyed: vi.fn(() => false),
        send: vi.fn()
      }
    }
    ctx = {
      windowManager: {
        createWindow: vi.fn(() => targetWindow),
        addPendingAction: vi.fn((_id: number, action: () => void | Promise<void>) => {
          pendingAction = action
        })
      }
    }
    vi.mocked(validateSecurePathInBase).mockResolvedValue('/root/docs/chapter.md')
    vi.mocked(fs.stat).mockResolvedValue({ isFile: () => true } as any)
    vi.mocked(activateFolderForWindow).mockResolvedValue({ id: 'h1', path: '/root/docs', name: 'docs', workspace: { id: 'w1', primaryRoot: '/root/docs', lifecycleEpoch: 2 } })
  })

  it('校验文件后创建窗口并注册就绪操作', async () => {
    const windowId = await openMarkdownInNewWindow(ctx, '/root/docs/chapter.md', '/root')

    expect(validateSecurePathInBase).toHaveBeenCalledWith('/root/docs/chapter.md', '/root')
    expect(ctx.windowManager.createWindow).toHaveBeenCalledTimes(1)
    expect(ctx.windowManager.addPendingAction).toHaveBeenCalledWith(2, expect.any(Function))
    expect(windowId).toBe(2)
    expect(targetWindow.webContents.send).not.toHaveBeenCalled()
  })

  it('窗口就绪后先激活父目录，再向新窗口打开文件', async () => {
    await openMarkdownInNewWindow(ctx, '/root/docs/chapter.md', '/root')
    await pendingAction?.()

    expect(activateFolderForWindow).toHaveBeenCalledWith(ctx, targetWindow, '/root/docs', {
      notifyRenderer: true
    })
    expect(targetWindow.webContents.send).toHaveBeenCalledWith(
      'open-specific-file',
      '/root/docs/chapter.md'
    )
  })

  it('拒绝非 Markdown，且不创建窗口', async () => {
    await expect(openMarkdownInNewWindow(ctx, '/root/docs/image.png', '/root'))
      .rejects.toThrow('只能在新窗口中打开 Markdown 文件')
    expect(ctx.windowManager.createWindow).not.toHaveBeenCalled()
  })

  it('路径校验失败时不创建窗口', async () => {
    vi.mocked(validateSecurePathInBase).mockRejectedValue(new Error('安全错误'))

    await expect(openMarkdownInNewWindow(ctx, '/outside/chapter.md', '/root'))
      .rejects.toThrow('安全错误')
    expect(ctx.windowManager.createWindow).not.toHaveBeenCalled()
  })

  it('目录激活失败时关闭新窗口且不发送打开事件', async () => {
    vi.mocked(activateFolderForWindow).mockRejectedValue(new Error('激活失败'))
    await openMarkdownInNewWindow(ctx, '/root/docs/chapter.md', '/root')
    await pendingAction?.()

    expect(targetWindow.close).toHaveBeenCalled()
    expect(targetWindow.webContents.send).not.toHaveBeenCalled()
  })

  it('执行 pending action 前窗口已关闭时安全退出', async () => {
    targetWindow.isDestroyed.mockReturnValue(true)
    await openMarkdownInNewWindow(ctx, '/root/docs/chapter.md', '/root')
    await pendingAction?.()

    expect(activateFolderForWindow).not.toHaveBeenCalled()
    expect(targetWindow.webContents.send).not.toHaveBeenCalled()
  })
})
