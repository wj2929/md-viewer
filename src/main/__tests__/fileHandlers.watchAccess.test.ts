import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ipcMain } from 'electron'
import { getFileWatcherState, registerFileHandlers } from '../ipc/fileHandlers'
import { workspaceWatchService } from '../watching/WorkspaceWatchService'

const mocks = vi.hoisted(() => ({
  readFile: vi.fn(), stat: vi.fn(), readdir: vi.fn(), glob: vi.fn(), validate: vi.fn(),
  accessed: vi.fn(), captureAccess: vi.fn(),
}))
vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  BrowserWindow: { fromWebContents: () => ({ id: 1, isDestroyed: () => false }) }, dialog: {},
}))
vi.mock('fs-extra', () => ({ readFile: mocks.readFile, stat: mocks.stat, readdir: mocks.readdir }))
vi.mock('glob', () => ({ glob: mocks.glob }))
vi.mock('../ipc/senderSecurity', () => ({
  getSenderWorkspace: (ctx: any) => ctx.windowManager.getWorkspace(),
  validateWorkspaceWritePath: async (_ctx: unknown, _event: unknown, _workspace: unknown, path: string) => path,
  validateSenderReadPath: mocks.validate,
}))
vi.mock('../watching/WorkspaceWatchService', () => ({
  isWatchPathSafe: () => ({ safe: true }), hasIgnoredPathSegment: () => false,
  workspaceWatchService: { attachRoot: vi.fn(), captureAccess: mocks.captureAccess, cleanupWebContents: vi.fn() },
}))
const handler = (name: string) => vi.mocked(ipcMain.handle).mock.calls.find(([channel]) => channel === name)![1] as (...args: any[]) => any
const sender = { id: 1, isDestroyed: vi.fn(() => false), send: vi.fn() }
const event = { sender }
const workspace = { id: 'access', lifecycleEpoch: 1, primaryRoot: '/docs' }

beforeEach(async () => {
  vi.clearAllMocks()
  workspace.lifecycleEpoch = 1
  sender.isDestroyed.mockReturnValue(false)
  mocks.validate.mockImplementation(async (_ctx, _event, path) => path)
  mocks.stat.mockResolvedValue({ size: 10 })
  mocks.readFile.mockResolvedValue('# Real read result')
  mocks.readdir.mockResolvedValue([])
  mocks.glob.mockResolvedValue(['a.md'])
  mocks.captureAccess.mockReturnValue(mocks.accessed)
  registerFileHandlers({ windowManager: { getWorkspace: () => workspace } } as any)
  await handler('fs:watchFolder')(event, '/docs', workspace.id, 1)
})
afterEach(() => getFileWatcherState().cleanup(sender.id))

describe('access evidence from authorized file handlers', () => {
  it('captures only the sender subscriptions before authorization and signals only after a real read', async () => {
    let finish!: (value: string) => void
    mocks.readFile.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const pending = handler('fs:readFile')(event, '/alias.md')
    expect(mocks.captureAccess).toHaveBeenCalledTimes(1)
    expect(mocks.captureAccess).toHaveBeenCalledWith(vi.mocked(workspaceWatchService.attachRoot).mock.calls[0][1])
    await vi.waitFor(() => expect(mocks.readFile).toHaveBeenCalledTimes(1))
    expect(mocks.accessed).not.toHaveBeenCalled()
    finish('# Read succeeded')
    await expect(pending).resolves.toBe('# Read succeeded')
    expect(mocks.accessed).toHaveBeenCalledWith('/alias.md')
    expect(mocks.captureAccess.mock.invocationCallOrder[0]).toBeLessThan(mocks.validate.mock.invocationCallOrder[0])
  })

  it.each(['authorization', 'stat', 'read', 'size'])('does not signal access on %s failure', async failure => {
    if (failure === 'authorization') mocks.validate.mockRejectedValueOnce(new Error('denied'))
    if (failure === 'stat') mocks.stat.mockRejectedValueOnce(new Error('stat failed'))
    if (failure === 'read') mocks.readFile.mockRejectedValueOnce(new Error('read failed'))
    if (failure === 'size') mocks.stat.mockResolvedValueOnce({ size: 6 * 1024 * 1024 })
    await expect(handler('fs:readFile')(event, '/docs/a.md')).rejects.toThrow()
    expect(mocks.accessed).not.toHaveBeenCalled()
  })

  it('uses the canonical authorized path, never the renderer alias', async () => {
    mocks.validate.mockResolvedValueOnce('/docs/canonical.md')
    await handler('fs:readFile')(event, '/alias.md')
    expect(mocks.accessed).toHaveBeenCalledWith('/docs/canonical.md')
    expect(mocks.accessed).not.toHaveBeenCalledWith('/alias.md')
    await handler('fs:readFile')({ sender: { id: 12 } }, '/docs/a.md')
    expect(mocks.captureAccess).toHaveBeenCalledTimes(1)
    expect(mocks.accessed).toHaveBeenCalledTimes(1)
  })

  it('checks real directory access before treating an empty glob as recovery proof', async () => {
    mocks.glob.mockResolvedValue([])
    mocks.readdir.mockRejectedValueOnce(new Error('EACCES'))
    await expect(handler('fs:readDir')(event, '/docs')).resolves.toEqual([])
    expect(mocks.accessed).not.toHaveBeenCalled()
    await handler('fs:readDir')(event, '/docs')
    expect(mocks.readdir).toHaveBeenCalledWith('/docs')
    expect(mocks.accessed).toHaveBeenCalledExactlyOnceWith('/docs')
  })

  it('reports only completed, authorized scans and does not turn scan failure into proof', async () => {
    mocks.glob.mockRejectedValueOnce(new Error('scan failed'))
    await handler('fs:readDir')(event, '/docs')
    expect(mocks.accessed).not.toHaveBeenCalled()
    await handler('fs:readDir')(event, '/docs')
    expect(mocks.accessed).toHaveBeenCalledExactlyOnceWith('/docs')
  })

  it.each(['epoch', 'destroyed', 'unwatch'])('reuses the original subscription validity check after %s', async change => {
    const sub = vi.mocked(workspaceWatchService.attachRoot).mock.calls[0][1]
    expect(sub.isCurrent?.()).toBe(true)
    if (change === 'epoch') workspace.lifecycleEpoch++
    if (change === 'destroyed') sender.isDestroyed.mockReturnValue(true)
    if (change === 'unwatch') await handler('fs:unwatchFolder')(event, workspace.id, 1)
    expect(sub.isCurrent?.()).toBe(false)
  })
})
