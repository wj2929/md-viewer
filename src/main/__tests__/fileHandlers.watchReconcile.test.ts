import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ipcMain } from 'electron'
import { getFileWatcherState, registerFileHandlers } from '../ipc/fileHandlers'
import { workspaceWatchService, type WorkspaceWatchSubscription } from '../watching/WorkspaceWatchService'
import { WatchReconcileSupersededError } from '../../shared/workspaceWatch'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  BrowserWindow: { fromWebContents: vi.fn(() => ({ id: 1, isDestroyed: () => false })) },
  dialog: {},
}))
vi.mock('../watching/WorkspaceWatchService', () => ({
  hasIgnoredPathSegment: vi.fn(() => false),
  isWatchPathSafe: vi.fn(() => ({ safe: true })),
  workspaceWatchService: { attachRoot: vi.fn(), cleanupWebContents: vi.fn() },
}))
vi.mock('../ipc/senderSecurity', () => ({
  getSenderWorkspace: (ctx: any) => ctx.windowManager.getWorkspace(),
  validateWorkspaceWritePath: async (_ctx: unknown, _event: unknown, _workspace: unknown, path: string) => path,
}))

function handler(channel: string): (...args: any[]) => any {
  return vi.mocked(ipcMain.handle).mock.calls.find(([name]) => name === channel)![1]
}

describe('watch reconciliation ACK binding', () => {
  const workspace = { id: 'workspace-ack', lifecycleEpoch: 1, primaryRoot: '/docs' }
  const sender = { id: 701, send: vi.fn(), isDestroyed: vi.fn(() => false) }
  let subscription: WorkspaceWatchSubscription
  beforeEach(async () => {
    vi.clearAllMocks()
    workspace.lifecycleEpoch = 1
    sender.isDestroyed.mockReturnValue(false)
    registerFileHandlers({ windowManager: { getWorkspace: () => workspace } } as any)
    await handler('fs:watchFolder')({ sender }, '/docs', workspace.id, 1)
    subscription = vi.mocked(workspaceWatchService.attachRoot).mock.calls[0][1]
  })
  afterEach(() => getFileWatcherState().cleanup(sender.id))

  function request() {
    const pending = subscription.reconcile!('refresh')
    const message = sender.send.mock.calls.find(([channel]) => channel === 'watch:reconcile')![1]
    return { pending, id: message.requestId }
  }

  it('rejects foreign senders, unknown IDs and boolean ACKs without consuming the request', async () => {
    const { pending, id } = request()
    const ack = handler('watch:reconciled')
    expect(ack({ sender: { id: 702 } }, id, 'ok')).toBe(false)
    expect(ack({ sender }, 'unknown', 'ok')).toBe(false)
    expect(ack({ sender }, id, true)).toBe(false)
    expect(ack({ sender }, id, 'ok')).toBe(true)
    await expect(pending).resolves.toBeUndefined()
    expect(ack({ sender }, id, 'ok')).toBe(false)
  })

  it.each(['superseded', 'failed'] as const)('preserves %s as a distinct rejection', async result => {
    const { pending, id } = request()
    const assertion = result === 'superseded'
      ? expect(pending).rejects.toBeInstanceOf(WatchReconcileSupersededError)
      : expect(pending).rejects.toThrow('文档变更补查未完成')
    expect(handler('watch:reconciled')({ sender }, id, result)).toBe(true)
    await assertion
  })

  it.each(['epoch', 'destroyed'] as const)('does not accept success after %s invalidation', async change => {
    const { pending, id } = request()
    const assertion = expect(pending).rejects.toBeInstanceOf(WatchReconcileSupersededError)
    if (change === 'epoch') workspace.lifecycleEpoch++
    else sender.isDestroyed.mockReturnValue(true)
    expect(handler('watch:reconciled')({ sender }, id, 'ok')).toBe(false)
    await assertion
  })

  it('cancels the old request on cleanup without accepting its late ACK', async () => {
    const { pending, id } = request()
    const assertion = expect(pending).rejects.toBeInstanceOf(WatchReconcileSupersededError)
    await handler('fs:unwatchFolder')({ sender }, workspace.id, 1)
    await assertion
    expect(handler('watch:reconciled')({ sender }, id, 'ok')).toBe(false)
  })
})
