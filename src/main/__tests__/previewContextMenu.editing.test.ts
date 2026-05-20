import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BrowserWindow, Menu, ipcMain } from 'electron'
import { registerMenuHandlers } from '../ipc/menuHandlers'

vi.mock('electron', () => ({
  BrowserWindow: {
    fromWebContents: vi.fn(),
  },
  Menu: {
    buildFromTemplate: vi.fn().mockReturnValue({
      popup: vi.fn(),
    }),
  },
  ipcMain: {
    handle: vi.fn(),
  },
  clipboard: {
    writeText: vi.fn(),
  },
  shell: {
    openPath: vi.fn(),
    showItemInFolder: vi.fn(),
  },
}))

vi.mock('../security', () => ({
  setAllowedBasePath: vi.fn(),
  getAllowedBasePath: vi.fn().mockReturnValue('/docs'),
  isPathAllowed: vi.fn().mockReturnValue(true),
  validatePath: vi.fn(),
}))

vi.mock('../contextMenuHandler', () => ({
  showContextMenu: vi.fn(),
}))

vi.mock('../tabMenuHandler', () => ({
  showTabContextMenu: vi.fn(),
}))

vi.mock('../markdownMenuHandler', () => ({
  showMarkdownContextMenu: vi.fn(),
}))

vi.mock('../appDataManager', () => ({
  appDataManager: {
    getSettings: vi.fn().mockReturnValue({
      docxExport: {
        remoteEnabled: false,
        localFallbackEnabled: false,
      },
    }),
  },
}))

vi.mock('../ipc/exportHandlers', () => ({
  getLastDocxExportPath: vi.fn().mockReturnValue(null),
}))

describe('preview context menu quick editing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('adds quick edit document action and emits a structured target', async () => {
    const sender = {
      send: vi.fn(),
      copy: vi.fn(),
    }
    const window = { webContents: sender }
    vi.mocked(BrowserWindow.fromWebContents).mockReturnValue(window as unknown as BrowserWindow)

    registerMenuHandlers({
      openPathInWindow: vi.fn(),
    } as any)

    const handler = vi.mocked(ipcMain.handle).mock.calls.find(([channel]) => channel === 'preview:show-context-menu')?.[1]
    expect(handler).toBeDefined()

    await handler?.({ sender } as any, {
      filePath: '/docs/report.md',
      headingId: null,
      headingText: null,
      headingLevel: null,
      hasSelection: false,
      linkHref: null,
      basePath: '/docs',
      tabId: 'tab-a',
      leafId: 'leaf-a',
      selectionText: '',
      sourceLine: null,
      scrollRatio: null,
      chartCount: 0,
    })

    const template = vi.mocked(Menu.buildFromTemplate).mock.calls.at(-1)?.[0] as any[]
    const item = template.find((entry) => entry.label === '✏️ 快速编辑')
    expect(item).toBeDefined()

    item.click()

    expect(sender.send).toHaveBeenCalledWith('markdown:quick-edit', {
      filePath: '/docs/report.md',
      tabId: 'tab-a',
      leafId: 'leaf-a',
      mode: 'document',
    })
  })

  it('shows quick edit here when source target is available', async () => {
    const sender = {
      send: vi.fn(),
      copy: vi.fn(),
    }
    const window = { webContents: sender }
    vi.mocked(BrowserWindow.fromWebContents).mockReturnValue(window as unknown as BrowserWindow)

    registerMenuHandlers({
      openPathInWindow: vi.fn(),
    } as any)

    const handler = vi.mocked(ipcMain.handle).mock.calls.find(([channel]) => channel === 'preview:show-context-menu')?.[1]

    await handler?.({ sender } as any, {
      filePath: '/docs/report.md',
      headingId: null,
      headingText: null,
      headingLevel: null,
      hasSelection: true,
      linkHref: null,
      basePath: '/docs',
      tabId: 'tab-a',
      leafId: 'leaf-a',
      selectionText: '重复文本',
      sourceLine: 42,
      scrollRatio: 0.5,
      chartCount: 0,
    })

    const template = vi.mocked(Menu.buildFromTemplate).mock.calls.at(-1)?.[0] as any[]
    const item = template.find((entry) => entry.label === '🎯 快速编辑此处')
    expect(item).toBeDefined()

    item.click()

    expect(sender.send).toHaveBeenCalledWith('markdown:quick-edit', {
      filePath: '/docs/report.md',
      tabId: 'tab-a',
      leafId: 'leaf-a',
      targetText: '重复文本',
      targetLine: 42,
      sourceLine: 42,
      scrollRatio: 0.5,
      mode: 'selection',
    })
  })

  it('adds batch chart download action when preview has exportable charts', async () => {
    const sender = {
      send: vi.fn(),
      copy: vi.fn(),
    }
    const window = { webContents: sender }
    vi.mocked(BrowserWindow.fromWebContents).mockReturnValue(window as unknown as BrowserWindow)

    registerMenuHandlers({
      openPathInWindow: vi.fn(),
    } as any)

    const handler = vi.mocked(ipcMain.handle).mock.calls.find(([channel]) => channel === 'preview:show-context-menu')?.[1]

    await handler?.({ sender } as any, {
      filePath: '/docs/report.md',
      headingId: null,
      headingText: null,
      headingLevel: null,
      hasSelection: false,
      linkHref: null,
      basePath: '/docs',
      tabId: 'tab-a',
      leafId: 'leaf-a',
      selectionText: '',
      sourceLine: null,
      scrollRatio: null,
      chartCount: 3,
    })

    const template = vi.mocked(Menu.buildFromTemplate).mock.calls.at(-1)?.[0] as any[]
    const item = template.find((entry) => entry.label === '📦 打包下载图表（3 张）')
    expect(item).toBeDefined()

    item.click()

    expect(sender.send).toHaveBeenCalledWith('markdown:export-charts-zip', {
      filePath: '/docs/report.md',
      tabId: 'tab-a',
      leafId: 'leaf-a',
    })
  })

  it('does not show batch chart download action when preview has no charts', async () => {
    const sender = {
      send: vi.fn(),
      copy: vi.fn(),
    }
    const window = { webContents: sender }
    vi.mocked(BrowserWindow.fromWebContents).mockReturnValue(window as unknown as BrowserWindow)

    registerMenuHandlers({
      openPathInWindow: vi.fn(),
    } as any)

    const handler = vi.mocked(ipcMain.handle).mock.calls.find(([channel]) => channel === 'preview:show-context-menu')?.[1]

    await handler?.({ sender } as any, {
      filePath: '/docs/report.md',
      headingId: null,
      headingText: null,
      headingLevel: null,
      hasSelection: false,
      linkHref: null,
      basePath: '/docs',
      tabId: 'tab-a',
      leafId: 'leaf-a',
      selectionText: '',
      sourceLine: null,
      scrollRatio: null,
      chartCount: 0,
    })

    const template = vi.mocked(Menu.buildFromTemplate).mock.calls.at(-1)?.[0] as any[]
    expect(template.some((entry) => String(entry.label || '').includes('打包下载图表'))).toBe(false)
  })
})
