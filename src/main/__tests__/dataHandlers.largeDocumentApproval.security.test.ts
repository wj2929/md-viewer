import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'fs-extra'
import * as os from 'node:os'
import * as path from 'node:path'
import { BrowserWindow, ipcMain } from 'electron'
import { registerDataHandlers } from '../ipc/dataHandlers'
import { resetSecurity } from '../security'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  BrowserWindow: { fromWebContents: vi.fn(), getAllWindows: vi.fn(() => []) },
  shell: { openPath: vi.fn(), openExternal: vi.fn() },
  app: { getPath: vi.fn(() => '/tmp'), getName: vi.fn(() => 'md-viewer') },
  net: { fetch: vi.fn() }
}))
const operation = { workspaceId: 'self-workspace', lifecycleEpoch: 1 }
const size = { characters: 1500001, lines: 3 }
const event = { sender: { id: 7 } } as Electron.IpcMainInvokeEvent
function handler(channel: string) {
  return vi.mocked(ipcMain.handle).mock.calls.find(([name]) => name === channel)![1]
}

describe('大文档批准 IPC 安全边界', () => {
  let directory: string, root: string, other: string
  let get: ReturnType<typeof vi.fn>, set: ReturnType<typeof vi.fn>, workspace: ReturnType<typeof vi.fn>
  beforeEach(async () => {
    vi.clearAllMocks()
    directory = await fs.mkdtemp(path.join(os.homedir(), 'mdv-approval-self-'))
    root = path.join(directory, 'root'); other = path.join(directory, 'other')
    await fs.ensureDir(root); await fs.ensureDir(other)
    await fs.writeFile(path.join(root, 'a.md'), '# self')
    await fs.writeFile(path.join(other, 'b.md'), '# self')
    get = vi.fn(() => size); set = vi.fn()
    workspace = vi.fn((_windowId, id) => id === operation.workspaceId ? { ...operation, primaryRoot: root } : undefined)
    vi.mocked(BrowserWindow.fromWebContents).mockReturnValue({ id: 1, isDestroyed: () => false } as Electron.BrowserWindow)
    registerDataHandlers({
      appDataManager: { getLargeDocumentApproval: get, setLargeDocumentApproval: set },
      folderHistoryManager: { getHistory: vi.fn(async () => []) },
      windowManager: { getWindowFolderPath: () => root, getAllWindowFolderRoots: () => [root, other], getWorkspace: workspace }
    } as any)
  })
  afterEach(async () => { resetSecurity(); await fs.remove(directory) })

  it('get只返回已授权文件的规模，set/撤销使用当前工作区路径', async () => {
    await expect(handler('large-document-approval:get')(event, path.join(root, 'a.md'))).resolves.toEqual(size)
    await handler('large-document-approval:set')(event, path.join(root, 'a.md'), size, operation)
    await handler('large-document-approval:set')(event, path.join(root, 'a.md'), null, operation)
    expect(set.mock.calls.map(call => call[1])).toEqual([size, null])
    expect(set.mock.calls[0][0]).toBe(await fs.realpath(path.join(root, 'a.md')))
  })

  it('其他已授权根可读，但不能借读授权写入批准或撤销', async () => {
    await expect(handler('large-document-approval:get')(event, path.join(other, 'b.md'))).resolves.toEqual(size)
    for (const value of [size, null]) await expect(handler('large-document-approval:set')(event, path.join(other, 'b.md'), value, operation)).rejects.toThrow()
    expect(set).not.toHaveBeenCalled()
  })

  it('拒绝未知sender、工作区与过期epoch', async () => {
    for (const context of [undefined, { ...operation, workspaceId: 'foreign' }, { ...operation, lifecycleEpoch: 2 }]) {
      await expect(handler('large-document-approval:set')(event, path.join(root, 'a.md'), size, context)).rejects.toThrow()
    }
    vi.mocked(BrowserWindow.fromWebContents).mockReturnValue(null)
    await expect(handler('large-document-approval:get')(event, path.join(root, 'a.md'))).rejects.toThrow()
    await expect(handler('large-document-approval:set')(event, path.join(root, 'a.md'), size, operation)).rejects.toThrow()
    expect(set).not.toHaveBeenCalled()
  })

  it('路径校验期间代次变化仍拒绝，不能用旧上下文写入', async () => {
    workspace.mockReturnValueOnce({ ...operation, primaryRoot: root }).mockReturnValue({ ...operation, lifecycleEpoch: 2, primaryRoot: root })
    await expect(handler('large-document-approval:set')(event, path.join(root, 'a.md'), size, operation)).rejects.toThrow('已失效')
    expect(set).not.toHaveBeenCalled()
  })

  it('拒绝目录、非Markdown、符号链接越界与受保护路径', async () => {
    await fs.ensureDir(path.join(root, 'directory.md'))
    await fs.writeFile(path.join(root, 'a.txt'), 'self')
    await fs.symlink(path.join(other, 'b.md'), path.join(root, 'escape.md'))
    for (const file of ['directory.md', 'a.txt', 'escape.md']) {
      await expect(handler('large-document-approval:set')(event, path.join(root, file), size, operation)).rejects.toThrow()
    }
    await expect(handler('large-document-approval:get')(event, '/etc/passwd')).rejects.toThrow()
    expect(set).not.toHaveBeenCalled()
  })

  it.each([{}, { characters: 1, lines: -1 }, { characters: 1.1, lines: 1 }, { characters: 'large', lines: 1 }])('拒绝无效规模：%j', async value => {
    await expect(handler('large-document-approval:set')(event, path.join(root, 'a.md'), value, operation)).rejects.toThrow('无效')
    expect(set).not.toHaveBeenCalled()
  })
})
