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
  const mocked = { ...actual, readdir: vi.fn(actual.readdir), lstat: vi.fn(actual.lstat) }
  return { ...mocked, default: mocked }
})

describe('workspace directory browsing', () => {
  let root: string
  let epoch: number
  let list: (event: Electron.IpcMainInvokeEvent, operation: WorkspaceOperationContext, relativePath: unknown, metadata?: unknown) => Promise<WorkspaceDirectoryEntry[]>
  const event = { sender: { id: 7 } } as Electron.IpcMainInvokeEvent
  const operation = { workspaceId: 'workspace', lifecycleEpoch: 1 }

  beforeEach(async () => {
    vi.clearAllMocks()
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
    vi.mocked(fs.lstat).mockImplementation(actual.lstat)
    vi.mocked(fs.readdir).mockImplementation(actual.readdir)
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

  it('reads only requested direct attributes and never uses directory byte size', async () => {
    await fs.writeFile(path.join(root, 'zero.bin'), '')
    await fs.utimes(path.join(root, 'assets'), 1000, 1000)
    const times = await list(event, operation, '', 'modified')
    expect(times.find(item => item.name === 'assets')?.mtimeMs).toBe(1000000)
    expect(times.find(item => item.name === 'data.json')?.mtimeMs).toBeGreaterThan(0)
    expect(times.every(item => !Object.hasOwn(item, 'size'))).toBe(true)
    expect(times.find(item => item.name === '.ssh')?.mtimeMs).toBeNull()
    const sizes = await list(event, operation, '', 'size')
    expect(sizes.find(item => item.name === 'zero.bin')?.size).toBe(0)
    expect(sizes.find(item => item.name === 'data.json')?.size).toBe(7)
    expect(sizes.find(item => item.name === 'assets')?.size).toBeNull()
    expect(sizes.every(item => !Object.hasOwn(item, 'mtimeMs'))).toBe(true)
    expect(vi.mocked(fs.readdir)).toHaveBeenCalledTimes(2)
  })

  it('does not stat child attributes for names and bounds direct attribute reads to eight', async () => {
    const actual = vi.mocked(fs.lstat).getMockImplementation()!
    let active = 0, peak = 0, reads = 0
    vi.mocked(fs.lstat).mockImplementation(async (...args: Parameters<typeof fs.lstat>) => {
      if (path.dirname(String(args[0])) !== root) return actual(...args)
      active++; reads++; peak = Math.max(peak, active)
      try { await new Promise<void>(resolve => setImmediate(resolve)); return await actual(...args) }
      finally { active-- }
    })
    for (let i = 0; i < 25; i++) await fs.writeFile(path.join(root, `${i}.txt`), '')
    await list(event, operation, '')
    expect(reads).toBe(0)
    await list(event, operation, '', 'modified')
    expect(reads).toBeGreaterThan(25)
    expect(peak).toBeGreaterThan(1)
    expect(peak).toBeLessThanOrEqual(8)
    expect(fs.readdir).toHaveBeenCalledTimes(2)
  })

  it('keeps unreadable attributes null and never follows link targets', async () => {
    const actual = vi.mocked(fs.lstat).getMockImplementation()!
    await fs.symlink('/etc', path.join(root, 'linked-outside'))
    vi.mocked(fs.lstat).mockImplementation(async (...args: Parameters<typeof fs.lstat>) => {
      if (String(args[0]) === path.join(root, 'data.json')) throw Object.assign(new Error('denied'), { code: 'EACCES' })
      return actual(...args)
    })
    const result = await list(event, operation, '', 'modified')
    expect(result.find(entry => entry.name === 'data.json')?.mtimeMs).toBeNull()
    expect(result.find(entry => entry.name === 'linked-outside')?.mtimeMs).toBeNull()
    expect(vi.mocked(fs.lstat).mock.calls.some(call => String(call[0]).endsWith('linked-outside'))).toBe(false)
  })

  it('rejects an epoch invalidated while reading attributes', async () => {
    const actual = vi.mocked(fs.lstat).getMockImplementation()!
    vi.mocked(fs.lstat).mockImplementation(async (...args: Parameters<typeof fs.lstat>) => {
      const stat = await actual(...args)
      if (path.dirname(String(args[0])) === root) epoch++
      return stat
    })
    await expect(list(event, operation, '', 'modified')).rejects.toThrow('失效')
  })

  it('rejects a directory replaced during its attribute pass', async () => {
    const actual = vi.mocked(fs.lstat).getMockImplementation()!
    let replaced = false
    vi.mocked(fs.lstat).mockImplementation(async (...args: Parameters<typeof fs.lstat>) => {
      const stat = await actual(...args)
      if (!replaced && String(args[0]) === path.join(root, 'assets', 'image.png')) {
        replaced = true
        await fs.rename(path.join(root, 'assets'), path.join(root, 'retired-assets'))
        await fs.mkdir(path.join(root, 'assets'))
      }
      return stat
    })
    await expect(list(event, operation, 'assets', 'size')).rejects.toThrow('目录已变化')
  })

  it('rejects unknown attribute requests before reading the directory', async () => {
    for (const metadata of [null, true, 'all', {}, { metadata: 'size' }]) {
      await expect(list(event, operation, '', metadata)).rejects.toThrow('属性')
    }
    expect(fs.readdir).not.toHaveBeenCalled()
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
