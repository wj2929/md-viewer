// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ipcMain, BrowserWindow } from 'electron'
import * as fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { registerDirectoryBrowserHandlers } from '../ipc/directoryBrowserHandlers'
import type { IPCContext } from '../ipc/context'
import { resetSecurity } from '../security'
import type { WorkspaceOperationContext } from '../../shared/workspace'
import type { WorkspaceDirectoryEntry } from '../../shared/directoryBrowser'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() }, BrowserWindow: { fromWebContents: vi.fn() } }))
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  const mocked = { ...actual, readdir: vi.fn(actual.readdir) }
  return { ...mocked, default: mocked }
})

describe('workspace directory browsing', () => {
  let root: string
  let epoch: number
  let list: (event: Electron.IpcMainInvokeEvent, operation: WorkspaceOperationContext, relativePath: unknown) => Promise<WorkspaceDirectoryEntry[]>
  const event = { sender: { id: 7 } } as Electron.IpcMainInvokeEvent
  const operation = { workspaceId: 'workspace', lifecycleEpoch: 1 }

  beforeEach(async () => {
    vi.clearAllMocks()
    epoch = 1
    root = await fs.mkdtemp(path.join(os.homedir(), 'md-viewer-browser-test-'))
    for (const name of ['empty', 'assets', 'node_modules', '.hidden', '.ssh']) await fs.mkdir(path.join(root, name))
    for (const name of ['readme.md', 'data.json', 'binary.bin', '中文 #?%.txt']) await fs.writeFile(path.join(root, name), 'fixture')
    await fs.writeFile(path.join(root, 'assets', 'image.png'), 'synthetic')
    vi.mocked(BrowserWindow.fromWebContents).mockReturnValue({ id: 1, isDestroyed: () => false } as Electron.BrowserWindow)
    registerDirectoryBrowserHandlers({ windowManager: { getWorkspace: (_id: number, id: string) => id === 'workspace'
      ? { id, primaryRoot: root, lifecycleEpoch: epoch } : undefined } } as unknown as IPCContext)
    list = vi.mocked(ipcMain.handle).mock.calls.find(([name]) => name === 'browser:listDirectory')![1] as typeof list
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    resetSecurity()
    await fs.rm(root, { recursive: true, force: true })
  })

  it('reads direct entries only, including empty, generated and hidden directories, without file contents', async () => {
    const result = await list(event, operation, '')
    expect(result.map(item => item.name)).toEqual(['.hidden', '.ssh', 'assets', 'empty', 'node_modules', 'binary.bin', 'data.json', 'readme.md', '中文 #?%.txt'])
    expect(result.find(item => item.name === 'assets')).toEqual({ name: 'assets', relativePath: 'assets', kind: 'directory' })
    expect(JSON.stringify(result)).not.toContain(root)
    expect(result.some(item => item.name === 'image.png')).toBe(false)
    expect(vi.mocked(fs.readdir)).toHaveBeenCalledTimes(1)
    expect(await list(event, operation, 'empty')).toEqual([])
    expect(await list(event, operation, 'assets')).toEqual([{ name: 'image.png', relativePath: 'assets/image.png', kind: 'file' }])
  })

  it('rejects traversal, absolute paths and malformed relative names', async () => {
    for (const rel of ['../outside', '/etc', 'C:/data', 'a\\b', 'a//b', '.', 'a/../b', 'a\0b', null]) {
      await expect(list(event, operation, rel)).rejects.toThrow('无效')
    }
  })

  it('requires the owning workspace and live epoch', async () => {
    await expect(list(event, { ...operation, workspaceId: 'other' }, '')).rejects.toThrow('工作区')
    epoch++
    await expect(list(event, operation, '')).rejects.toThrow('失效')
  })

  it('shows symlinks without following them and refuses protected, missing and file directories', async () => {
    await fs.symlink(path.join(root, 'assets'), path.join(root, 'linked'))
    expect((await list(event, operation, '')).find(item => item.name === 'linked')?.kind).toBe('link')
    await expect(list(event, operation, 'linked')).rejects.toThrow('符号链接')
    await expect(list(event, operation, '.ssh')).rejects.toThrow('受保护')
    await expect(list(event, operation, 'missing')).rejects.toThrow()
    await expect(list(event, operation, 'readme.md')).rejects.toThrow('目录')
  })

  it('rejects a lifecycle invalidated during directory IO', async () => {
    const read = vi.mocked(fs.readdir).getMockImplementation()
    expect(read).toBeDefined()
    vi.mocked(fs.readdir).mockImplementationOnce(async (...args: Parameters<typeof fs.readdir>) => {
      const result = await read!(...args)
      epoch++
      return result
    })
    await expect(list(event, operation, '')).rejects.toThrow('失效')
  })
})
