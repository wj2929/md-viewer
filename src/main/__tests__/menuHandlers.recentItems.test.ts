import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'fs/promises'
import { join, sep } from 'path'
import { tmpdir } from 'os'
import { BrowserWindow, Menu, clipboard, ipcMain, shell } from 'electron'
import { registerMenuHandlers } from '../ipc/menuHandlers'
import { getFileManagerLabels } from '../platformMenuLabels'

vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: vi.fn() },
  Menu: { buildFromTemplate: vi.fn(template => ({ template, popup: vi.fn() })) },
  ipcMain: { handle: vi.fn() },
  clipboard: { writeText: vi.fn() },
  shell: { showItemInFolder: vi.fn(), openPath: vi.fn() },
}))

vi.mock('../security', () => ({
  validateSecurePathInBase: vi.fn(async (target: string, base: string) => {
    if (target !== base && !target.startsWith(`${base}${sep}`)) throw new Error('outside')
    return target
  }),
}))

vi.mock('../ipc/senderSecurity', () => ({
  getSenderWorkspaceForOperation: vi.fn(),
  validateSenderReadPath: vi.fn(async (_ctx: unknown, _event: unknown, target: string) => target),
  resolveRecentFolderRoot: vi.fn(async (ctx: any) => ctx.authorizedRoot),
}))

vi.mock('../contextMenuHandler', () => ({
  showContextMenu: vi.fn(),
  dispatchFileClipboardAction: vi.fn(),
}))
vi.mock('../tabMenuHandler', () => ({ showTabContextMenu: vi.fn() }))
vi.mock('../markdownMenuHandler', () => ({ showMarkdownContextMenu: vi.fn() }))
vi.mock('../appDataManager', () => ({
  appDataManager: {
    getSettings: vi.fn(() => ({ docxExport: { remoteEnabled: false, localFallbackEnabled: false } })),
  },
}))
vi.mock('../ipc/exportHandlers', () => ({ getLastDocxExportPath: vi.fn(() => null) }))
vi.mock('../openMarkdownInNewWindow', () => ({ openMarkdownInNewWindow: vi.fn(async () => undefined) }))
vi.mock('../folderActivation', () => ({ openFolderInNewWindow: vi.fn() }))

describe('最近项右键菜单', () => {
  let tempDir: string
  let root: string
  let filePath: string
  let sender: { send: ReturnType<typeof vi.fn> }
  let context: any

  beforeEach(async () => {
    vi.clearAllMocks()
    tempDir = await realpath(await mkdtemp(join(tmpdir(), 'mdv-recent-menu-')))
    root = join(tempDir, '工作区')
    filePath = join(root, 'docs', '说明 #1.md')
    await mkdir(join(root, 'docs'), { recursive: true })
    await writeFile(filePath, '# test')
    sender = { send: vi.fn() }
    vi.mocked(BrowserWindow.fromWebContents).mockReturnValue({ webContents: sender } as any)
    context = {
      authorizedRoot: root,
      appDataManager: {
        getRecentFile: vi.fn(() => ({
          id: 'recent-1', path: filePath, name: '说明 #1.md', folderPath: root, lastOpened: 1,
        })),
      },
      folderHistoryManager: {
        getHistory: vi.fn(async () => [{ id: 'folder-1', path: root, name: '工作区', lastOpened: 1 }]),
        resolveHistoryFolder: vi.fn(async () => root),
      },
    }
    registerMenuHandlers(context)
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  function handler(channel: string): (...args: any[]) => Promise<any> {
    return vi.mocked(ipcMain.handle).mock.calls.find(([name]) => name === channel)![1] as any
  }

  it('最近文件从 opaque ID 构建显示、复制和既有操作', async () => {
    const result = await handler('context-menu:recent-file')({ sender }, 'recent-1')
    expect(result).toEqual({ success: true })
    expect(context.appDataManager.getRecentFile).toHaveBeenCalledWith('recent-1')

    const template = vi.mocked(Menu.buildFromTemplate).mock.calls.at(-1)![0] as any[]
    expect(template.map(item => item.type ?? item.label)).toEqual([
      `📂 ${getFileManagerLabels().showInFolder}`,
      '📋 复制路径',
      '📎 复制相对路径',
      'separator',
      '📐 在分屏中打开',
      '🗔 在新窗口中打开',
      'separator',
      '🗑️ 从历史中移除',
    ])

    template[0].click()
    expect(shell.showItemInFolder).toHaveBeenCalledWith(filePath)
    template[1].click()
    expect(clipboard.writeText).toHaveBeenCalledWith(filePath)
    template[2].click()
    expect(clipboard.writeText).toHaveBeenCalledWith('docs/说明 #1.md')
    template[4].submenu[0].click()
    expect(sender.send).toHaveBeenCalledWith('file:open-in-split', {
      filePath,
      direction: 'horizontal',
    })
    template[7].click()
    expect(sender.send).toHaveBeenCalledWith('recent-file:remove', filePath)
  })

  it('最近文件夹只提供显示、绝对路径和既有新窗口操作', async () => {
    const result = await handler('context-menu:recent-folder')({ sender }, 'folder-1')
    expect(result).toEqual({ success: true })
    expect(context.folderHistoryManager.resolveHistoryFolder).toHaveBeenCalledWith('folder-1')

    const template = vi.mocked(Menu.buildFromTemplate).mock.calls.at(-1)![0] as any[]
    expect(template.map(item => item.type ?? item.label)).toEqual([
      `📂 ${getFileManagerLabels().showInFolder}`,
      '📋 复制路径',
      'separator',
      '🗔 在新窗口中打开',
    ])
    expect(template.some(item => item.label?.includes('相对路径'))).toBe(false)
    template[0].click()
    expect(shell.showItemInFolder).toHaveBeenCalledWith(root)
    template[1].click()
    expect(clipboard.writeText).toHaveBeenCalledWith(root)
  })

  it('拒绝 renderer 传入路径对象冒充 opaque ID', async () => {
    const result = await handler('context-menu:recent-file')({ sender }, {
      id: 'recent-1', filePath: filePath,
    })

    expect(result).toEqual({ success: false, error: '最近文件标识无效' })
    expect(context.appDataManager.getRecentFile).not.toHaveBeenCalled()
    expect(Menu.buildFromTemplate).not.toHaveBeenCalled()
  })
})
