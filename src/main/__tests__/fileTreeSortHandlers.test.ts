// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ipcMain, BrowserWindow } from 'electron'
import * as fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { registerFileTreeSortHandlers } from '../ipc/fileTreeSortHandlers'
import type { IPCContext } from '../ipc/context'
import { resetSecurity } from '../security'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() }, BrowserWindow: { fromWebContents: vi.fn() } }))
vi.mock('node:fs/promises', async importOriginal => {
  const original = await importOriginal<typeof import('node:fs/promises')>()
  const mocked = { ...original, stat: vi.fn(original.stat) }
  return { ...mocked, default: mocked }
})

describe('file tree sort metadata security', () => {
  let root: string
  let epoch: number
  let handler: (event: Electron.IpcMainInvokeEvent, paths: unknown, operation: { workspaceId: string; lifecycleEpoch: number }) => Promise<unknown>
  const event = { sender: { id: 7 } } as Electron.IpcMainInvokeEvent
  const operation = { workspaceId: 'w', lifecycleEpoch: 1 }
  beforeEach(async () => {
    vi.clearAllMocks()
    epoch = 1
    root = await fs.mkdtemp(path.join(os.homedir(), 'md-viewer-sort-'))
    await fs.writeFile(path.join(root, 'inside.md'), '# fixture')
    vi.mocked(BrowserWindow.fromWebContents).mockReturnValue({ id: 1, isDestroyed: () => false } as Electron.BrowserWindow)
    registerFileTreeSortHandlers({ windowManager: { getWorkspace: (_id: number, id: string) => id === 'w' ? { id, primaryRoot: root, lifecycleEpoch: epoch } : undefined } } as unknown as IPCContext)
    handler = vi.mocked(ipcMain.handle).mock.calls.find(([name]) => name === 'fs:fileTreeMetadata')![1] as typeof handler
  })
  afterEach(async () => { resetSecurity(); await fs.rm(root, { recursive: true, force: true }) })
  it('returns only relative names and finite metadata, deduplicates requests', async () => {
    const result = await handler(event, ['inside.md', 'inside.md'], operation) as Array<{ relativePath: string; value: { size: number; mtimeMs: number } }>
    expect(result).toHaveLength(1)
    expect(result[0].relativePath).toBe('inside.md')
    expect(result[0].value.size).toBe(9)
    expect(Number.isFinite(result[0].value.mtimeMs)).toBe(true)
    expect(JSON.stringify(result)).not.toContain(root)
  })
  it('returns ordinary Password document metadata but keeps protected names unavailable', async () => {
    await fs.mkdir(path.join(root, 'PasswordReset'))
    const names = ['FillPassword.md', 'api_FillPassword_review.md', 'PasswordReset/README.md']
    for (const name of [...names, 'myPassword.md']) {
      await fs.writeFile(path.join(root, name), '# Synthetic fixture')
    }
    const expected = await Promise.all(names.map(async relativePath => {
      const info = await fs.stat(path.join(root, relativePath))
      return { relativePath, value: { size: info.size, mtimeMs: info.mtimeMs } }
    }))
    const result = await handler(event, [...names, 'myPassword.md'], operation)
    expect(result).toEqual([...expected, { relativePath: 'myPassword.md', value: null }])
    expect(JSON.stringify(result)).not.toContain(root)
  })
  it('rejects traversal, absolute, backslash, unsupported and oversized inputs', async () => {
    for (const input of [['../outside.md'], ['/etc/test.md'], ['a\\b.md'], ['a/./b.md'], ['a//b.md'], ['x.sql'], ['x\0.md'], Array(257).fill('inside.md'), null]) {
      await expect(handler(event, input, operation)).rejects.toThrow('无效')
    }
  })
  it('requires the sender workspace and current epoch', async () => {
    await expect(handler(event, ['inside.md'], { ...operation, workspaceId: 'other' })).rejects.toThrow('工作区')
    epoch++
    await expect(handler(event, ['inside.md'], operation)).rejects.toThrow('失效')
  })
  it('does not expose symlink escape, protected files, missing files or directories', async () => {
    const outside = await fs.mkdtemp(path.join(os.homedir(), 'md-viewer-sort-outside-'))
    try {
      await fs.writeFile(path.join(outside, 'outside.md'), 'outside')
      await fs.symlink(path.join(outside, 'outside.md'), path.join(root, 'link.md'))
      await fs.mkdir(path.join(root, '.ssh'))
      await fs.writeFile(path.join(root, '.ssh/private.md'), 'private')
      await fs.mkdir(path.join(root, 'folder.md'))
      const result = await handler(event, ['link.md', '.ssh/private.md', 'missing.md', 'folder.md'], operation) as Array<{ value: unknown }>
      expect(result.map(item => item.value)).toEqual([null, null, null, null])
    } finally { await fs.rm(outside, { recursive: true, force: true }) }
  })
  it('limits stat concurrency to eight workers', async () => {
    const info = await fs.stat(path.join(root, 'inside.md'))
    const paths = Array.from({ length: 24 }, (_, index) => `${index}.md`)
    await Promise.all(paths.map(name => fs.writeFile(path.join(root, name), 'fixture')))
    let active = 0
    let maximum = 0
    for (let index = 0; index < paths.length; index++) vi.mocked(fs.stat).mockImplementationOnce(async () => {
      active++
      maximum = Math.max(maximum, active)
      await new Promise(resolve => setTimeout(resolve, 5))
      active--
      return info
    })
    await expect(handler(event, paths, operation)).resolves.toHaveLength(24)
    expect(maximum).toBeLessThanOrEqual(8)
    expect(maximum).toBeGreaterThan(1)
    expect(active).toBe(0)
  })

  it('rejects overlapping batches from the same sender and rechecks lifecycle after IO', async () => {
    const first = handler(event, ['inside.md'], operation)
    await expect(handler(event, ['inside.md'], operation)).rejects.toThrow('仍在进行')
    epoch++
    await expect(first).rejects.toThrow('失效')
    await expect(handler(event, ['inside.md'], { ...operation, lifecycleEpoch: epoch })).resolves.toHaveLength(1)
  })
})
