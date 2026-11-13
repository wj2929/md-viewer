import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, writeFile, symlink, rm, realpath } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import type { BrowserWindow } from 'electron'
import { activateFolderForWindow } from '../folderActivation'
import { resetSecurity } from '../security'
import type { IPCContext } from '../ipc/context'

vi.mock('electron', () => ({ BrowserWindow: {} }))

let root: string
beforeEach(async () => {
  resetSecurity()
  root = await mkdtemp(path.join(os.homedir(), 'mdv-initial-activation-'))
  await mkdir(path.join(root, 'docs'))
  await writeFile(path.join(root, 'docs', 'initial.md'), '# Initial')
  await writeFile(path.join(root, 'outside.md'), '# Outside')
})
afterEach(async () => { resetSecurity(); await rm(root, { recursive: true, force: true }) })

function fixture() {
  const send = vi.fn(), replace = vi.fn((_window, id, primaryRoot) => ({ id, primaryRoot, lifecycleEpoch: 2 }))
  const ctx = {
    windowManager: { getActiveWorkspaceId: () => 'workspace', getWorkspace: () => ({ primaryRoot: null, lifecycleEpoch: 1 }), replaceWorkspaceRoot: replace },
    folderHistoryManager: { addFolder: vi.fn(async () => ({ id: 'history', name: 'docs' })) },
    store: { set: vi.fn() },
  } as unknown as IPCContext
  const window = { id: 1, webContents: { id: 7, send } } as unknown as BrowserWindow
  return { ctx, window, send, replace }
}

describe('folder activation initial file delivery', () => {
  it('delivers a root-relative initial file with activation, without a delayed bare-path event', async () => {
    const { ctx, window, send } = fixture()
    const result = await activateFolderForWindow(ctx, window, path.join(root, 'docs'), {
      notifyRenderer: true, initialFilePath: path.join(root, 'docs', 'initial.md'),
    })
    expect(result.initialFileRelativePath).toBe('initial.md')
    expect(result.path).toBe(await realpath(path.join(root, 'docs')))
    expect(send.mock.calls.map(([channel]) => channel)).toEqual(['workspace:folder-activated', 'restore-folder'])
    expect(send).toHaveBeenLastCalledWith('restore-folder', expect.objectContaining({ initialFileRelativePath: 'initial.md' }))
  })

  it.each(['parent', 'symlink'])('rejects %s traversal before changing the authorized root', async escape => {
    const { ctx, window, send, replace } = fixture()
    const target = escape === 'parent' ? path.join(root, 'outside.md') : path.join(root, 'docs', 'escape.md')
    if (escape === 'symlink') await symlink(path.join(root, 'outside.md'), target)
    await expect(activateFolderForWindow(ctx, window, path.join(root, 'docs'), {
      notifyRenderer: true, initialFilePath: target,
    })).rejects.toThrow('不在允许范围内')
    expect(replace).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })
})
