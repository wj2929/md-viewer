import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'fs-extra'
import * as os from 'os'
import * as path from 'path'
import { BrowserWindow, ipcMain } from 'electron'
import { registerDataHandlers } from '../ipc/dataHandlers'
import { resetSecurity } from '../security'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  BrowserWindow: {
    fromWebContents: vi.fn(),
    getAllWindows: vi.fn(() => [])
  },
  shell: { openPath: vi.fn(), openExternal: vi.fn() },
  app: { getPath: vi.fn(() => '/tmp'), getName: vi.fn(() => 'md-viewer') },
  net: { fetch: vi.fn() }
}))

const temporaryPaths: string[] = []
const OPERATION = { workspaceId: 'workspace-a', lifecycleEpoch: 1 }

function getHandler<T extends (...args: any[]) => any>(channel: string): T {
  const registration = vi.mocked(ipcMain.handle).mock.calls.find(([name]) => name === channel)
  if (!registration) throw new Error(`Missing handler: ${channel}`)
  return registration[1] as T
}

function createEvent() {
  return { sender: { id: 7 } }
}

describe('folder-tab-session IPC 安全边界', () => {
  let root: string
  let saveFolderTabSession: ReturnType<typeof vi.fn>
  let getFolderTabSession: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.clearAllMocks()
    root = await fs.mkdtemp(path.join(os.homedir(), 'md-viewer-fts-'))
    temporaryPaths.push(root)
    await fs.writeFile(path.join(root, 'inside.md'), '# inside')

    vi.mocked(BrowserWindow.fromWebContents).mockReturnValue(
      { id: 1, isDestroyed: () => false } as unknown as Electron.BrowserWindow
    )

    saveFolderTabSession = vi.fn()
    getFolderTabSession = vi.fn(async () => ({ tabs: [], activePath: null }))

    registerDataHandlers({
      appDataManager: { saveFolderTabSession, getFolderTabSession },
      folderHistoryManager: { getHistory: vi.fn(async () => []), findContainingFolder: vi.fn(async () => null) },
      windowManager: {
        getWindowFolderPath: vi.fn(() => root),
        getAllWindowFolderRoots: vi.fn(() => [root]),
        getWorkspace: vi.fn(() => ({ ...OPERATION, primaryRoot: root })),
      }
    } as any)
  })

  afterEach(async () => {
    resetSecurity()
    await Promise.all(temporaryPaths.splice(0).map(dir => fs.remove(dir)))
  })

  it('save 只归档落在工作区根内的路径，跳过越权路径', async () => {
    const save = getHandler<
      (event: Electron.IpcMainInvokeEvent, payload: any, operation: typeof OPERATION) => Promise<void>
    >('folder-tab-session:save')

    await save(
      createEvent() as Electron.IpcMainInvokeEvent,
      {
        tabs: [
          { filePath: path.join(root, 'inside.md'), isPinned: true },
          { filePath: '/etc/passwd' },
          { filePath: path.join(root, '..', 'outside.md') }
        ],
        activeFilePath: path.join(root, 'inside.md')
      },
      OPERATION
    )

    expect(saveFolderTabSession).toHaveBeenCalledTimes(1)
    const [passedRoot, validTabs, activeCanonical] = saveFolderTabSession.mock.calls[0]
    expect(passedRoot).toBe(root)
    expect(validTabs).toHaveLength(1)
    expect(await fs.realpath(validTabs[0].filePath)).toBe(await fs.realpath(path.join(root, 'inside.md')))
    expect(validTabs[0].isPinned).toBe(true)
    expect(await fs.realpath(activeCanonical)).toBe(await fs.realpath(path.join(root, 'inside.md')))
  })

  it('save 缺少工作区上下文时拒绝（epoch 不匹配）', async () => {
    const save = getHandler<
      (event: Electron.IpcMainInvokeEvent, payload: any, operation: any) => Promise<void>
    >('folder-tab-session:save')

    await expect(
      save(
        createEvent() as Electron.IpcMainInvokeEvent,
        { tabs: [{ filePath: path.join(root, 'inside.md') }], activeFilePath: null },
        { workspaceId: 'workspace-a', lifecycleEpoch: 999 }
      )
    ).rejects.toThrow()
    expect(saveFolderTabSession).not.toHaveBeenCalled()
  })

  it('get 目标是文件（非目录）时拒绝', async () => {
    const get = getHandler<
      (event: Electron.IpcMainInvokeEvent, folderPath: string) => Promise<unknown>
    >('folder-tab-session:get-for-folder')

    await expect(
      get(createEvent() as Electron.IpcMainInvokeEvent, path.join(root, 'inside.md'))
    ).rejects.toThrow(/不是目录/)
    expect(getFolderTabSession).not.toHaveBeenCalled()
  })

  it('get 目标是已授权目录时转发到 appDataManager', async () => {
    const get = getHandler<
      (event: Electron.IpcMainInvokeEvent, folderPath: string) => Promise<unknown>
    >('folder-tab-session:get-for-folder')

    await get(createEvent() as Electron.IpcMainInvokeEvent, root)
    expect(getFolderTabSession).toHaveBeenCalledTimes(1)
    expect(await fs.realpath(getFolderTabSession.mock.calls[0][0])).toBe(await fs.realpath(root))
  })
})
