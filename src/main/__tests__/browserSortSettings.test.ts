// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BrowserWindow, ipcMain } from 'electron'
import { registerDataHandlers } from '../ipc/dataHandlers'
import type { IPCContext } from '../ipc/context'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  BrowserWindow: { getAllWindows: vi.fn() },
  app: { getPath: vi.fn(() => '/tmp'), getName: vi.fn(() => 'md-viewer') },
  shell: { openPath: vi.fn() }, net: { fetch: vi.fn() },
}))

const handler = (name: string) => vi.mocked(ipcMain.handle).mock.calls.find(call => call[0] === name)![1]

describe('independent browser sort settings IPC', () => {
  let settings: Record<string, unknown>
  const update = vi.fn()
  const send = vi.fn()
  beforeEach(() => {
    vi.clearAllMocks()
    settings = { maxRecentFiles: 500, fileTreeSort: { by: 'natural', direction: 'asc' } }
    update.mockImplementation(value => { settings = { ...settings, ...value } })
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([
      { isDestroyed: () => false, webContents: { send } },
      { isDestroyed: () => true, webContents: { send } },
    ] as unknown as Electron.BrowserWindow[])
    registerDataHandlers({ appDataManager: { getSettings: () => settings, updateSettings: update } } as unknown as IPCContext)
  })

  it('normalizes old settings without copying the tree value or writing defaults', async () => {
    expect(await handler('settings:browserSort')({} as Electron.IpcMainInvokeEvent)).toEqual({ value: { by: 'name', direction: 'asc' }, revision: 0 })
    expect(settings).not.toHaveProperty('browserSort')
    expect(update).not.toHaveBeenCalled()
  })

  it('broadcasts only the changed preference with independent monotonic revisions', async () => {
    const event = {} as Electron.IpcMainInvokeEvent
    const write = handler('settings:update')
    await write(event, { browserSort: { by: 'size', direction: 'desc' } })
    expect(send).toHaveBeenCalledExactlyOnceWith('settings:browserSortChanged', { value: { by: 'size', direction: 'desc' }, revision: 1 })
    expect(await handler('settings:fileTreeSort')(event)).toEqual({ value: { by: 'natural', direction: 'asc' }, revision: 0 })
    await write(event, { fileTreeSort: { by: 'modified', direction: 'asc' } })
    expect(await handler('settings:browserSort')(event)).toEqual({ value: { by: 'size', direction: 'desc' }, revision: 1 })
    expect(settings.maxRecentFiles).toBe(500)
  })

  it('rejects invalid preferences before writing or broadcasting', async () => {
    await expect(handler('settings:update')({} as Electron.IpcMainInvokeEvent, { browserSort: { by: 'manual', direction: 'asc' } })).rejects.toThrow('无效')
    expect(update).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })
})
