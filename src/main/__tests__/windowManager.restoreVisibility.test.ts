import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electronState = vi.hoisted(() => ({ nextWindowId: 1 }))

vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')

  class FakeWebContents extends EventEmitter {
    id = 100
    session = { webRequest: { onHeadersReceived: vi.fn() } }
    setWindowOpenHandler = vi.fn()
    openDevTools = vi.fn()
    isDestroyed = vi.fn(() => false)
    send = vi.fn()
  }

  class FakeBrowserWindow extends EventEmitter {
    id = electronState.nextWindowId++
    webContents = new FakeWebContents()
    show = vi.fn()
    showInactive = vi.fn()
    maximize = vi.fn()
    setAlwaysOnTop = vi.fn()
    loadFile = vi.fn()
    loadURL = vi.fn()
    isDestroyed = vi.fn(() => false)
  }

  return {
    app: { getAppPath: vi.fn(() => '/app') },
    BrowserWindow: FakeBrowserWindow,
    shell: { openExternal: vi.fn() },
  }
})
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false } }))
vi.mock('../shortcuts', () => ({ registerWindowShortcuts: vi.fn() }))
vi.mock('../clipboardState', () => ({ clearClipboardState: vi.fn() }))
vi.mock('../workspaceTransferCoordinator', () => ({
  workspaceTransferCoordinator: { cancelForWindow: vi.fn(() => []) },
}))
vi.mock('../windowTransferCoordinator', () => ({
  windowTransferCoordinator: { cancelForWindow: vi.fn(() => []) },
}))
vi.mock('../localImageProtocol', () => ({
  registerLocalImageProtocol: vi.fn(),
  revokeLocalImageCapabilities: vi.fn(),
}))
vi.mock('../securityPolicy', () => ({ createContentSecurityPolicy: vi.fn(() => '') }))

const { WindowManager } = await import('../windowManager')

describe('WindowManager restore visibility', () => {
  const previousVisible = process.env.MD_VIEWER_E2E_VISIBLE

  beforeEach(() => {
    process.env.MD_VIEWER_E2E_VISIBLE = '1'
  })

  afterEach(() => {
    if (previousVisible === undefined) delete process.env.MD_VIEWER_E2E_VISIBLE
    else process.env.MD_VIEWER_E2E_VISIBLE = previousVisible
  })

  it('前台窗口 ready 后正常 show', () => {
    const window = new WindowManager().createWindow() as any

    window.emit('ready-to-show')

    expect(window.show).toHaveBeenCalledOnce()
    expect(window.showInactive).not.toHaveBeenCalled()
  })

  it('后台恢复窗口先还原最大化状态再 showInactive', () => {
    const window = new WindowManager().createWindow({
      showInactive: true,
      isMaximized: true,
    }) as any

    window.emit('ready-to-show')

    expect(window.showInactive).toHaveBeenCalledOnce()
    expect(window.show).not.toHaveBeenCalled()
    expect(window.maximize).toHaveBeenCalledOnce()
    expect(window.maximize.mock.invocationCallOrder[0]).toBeLessThan(
      window.showInactive.mock.invocationCallOrder[0],
    )
  })

  it('隐藏 E2E 模式保持窗口不可见', () => {
    process.env.MD_VIEWER_E2E_VISIBLE = '0'
    const window = new WindowManager().createWindow({ showInactive: true }) as any

    window.emit('ready-to-show')

    expect(window.showInactive).not.toHaveBeenCalled()
    expect(window.show).not.toHaveBeenCalled()
  })
})
