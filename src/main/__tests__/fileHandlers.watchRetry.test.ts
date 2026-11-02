import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BrowserWindow, ipcMain } from 'electron'
import { registerFileHandlers } from '../ipc/fileHandlers'
import { workspaceWatchService } from '../watching/WorkspaceWatchService'
import { sanitizeDiagnosticMetadata } from '../../shared/diagnostics'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  BrowserWindow: { fromWebContents: vi.fn() },
  dialog: {},
}))
vi.mock('../watching/WorkspaceWatchService', () => ({
  hasIgnoredPathSegment: vi.fn(() => false),
  isWatchPathSafe: vi.fn(() => ({ safe: true })),
  workspaceWatchService: { retry: vi.fn() },
}))

const workspace = { id: 'private-workspace', lifecycleEpoch: 1, primaryRoot: '/private/fixture-root' }
const event = { sender: { id: 701 } } as Electron.IpcMainInvokeEvent
const record = vi.fn()
const getWorkspace = vi.fn()
function retry(workspaceId: unknown = workspace.id, epoch: unknown = 1) {
  const handler = vi.mocked(ipcMain.handle).mock.calls.find(([name]) => name === 'watch:retry')![1]
  return handler(event, workspaceId, epoch)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(BrowserWindow.fromWebContents).mockReturnValue({ id: 1, isDestroyed: () => false } as Electron.BrowserWindow)
  getWorkspace.mockImplementation((windowId, id) => windowId === 1 && id === workspace.id ? workspace : undefined)
  registerFileHandlers({
    windowManager: { getWorkspace },
    diagnosticEventLogService: { recordMainEvent: record },
  } as any)
})

describe('watch retry entry diagnostics', () => {
  it('records arrival before validation and correlates selected/host decisions without registering a file operation', () => {
    vi.mocked(workspaceWatchService.retry).mockImplementation((_key, observe) => {
      observe?.({ watchRetryStage: 'subscriptions-selected', watchSelectedCount: 0, watchRootSelected: false, watchOpenedSelectedCount: 0 })
      observe?.({ watchRetryStage: 'host-skipped', watchRetryReason: 'no-subscriptions' })
    })
    expect(retry()).toEqual({ accepted: true })
    expect(vi.mocked(workspaceWatchService.retry).mock.calls[0][0]).toBe('701:private-workspace')
    const rows = record.mock.calls.map(([row]) => row)
    expect(rows.map(row => row.metadata.watchRetryStage)).toEqual(['received', 'subscriptions-selected', 'host-skipped'])
    expect(new Set(rows.map(row => row.operationId)).size).toBe(1)
    expect(rows[0].operationId).toMatch(/^watch_retry_/)
    expect(rows.every(row => row.event === 'watcher.work.summary')).toBe(true)
    expect(rows[0].rawWorkspacePath).toBeUndefined()
    expect(rows[1].rawWorkspacePath).toBe(workspace.primaryRoot)
    for (const row of rows) {
      expect(sanitizeDiagnosticMetadata(row.metadata)).toEqual(row.metadata)
      expect(JSON.stringify(row.metadata)).not.toContain(workspace.id)
      expect(JSON.stringify(row.metadata)).not.toContain(workspace.primaryRoot)
    }
  })

  it.each(['missing-epoch', 'invalid-epoch', 'foreign-workspace', 'stale-epoch', 'unknown-sender', 'destroyed-sender'])('logs context rejection without retrying or changing the existing error (%s)', reason => {
    let id: unknown = workspace.id, epoch: unknown = 1
    if (reason === 'missing-epoch') epoch = null
    if (reason === 'invalid-epoch') epoch = Number.NaN
    if (reason === 'foreign-workspace') id = '/private/untrusted-workspace'
    if (reason === 'stale-epoch') epoch = 2
    if (reason === 'unknown-sender') vi.mocked(BrowserWindow.fromWebContents).mockReturnValue(null)
    if (reason === 'destroyed-sender') vi.mocked(BrowserWindow.fromWebContents).mockReturnValue({ id: 1, isDestroyed: () => true } as Electron.BrowserWindow)
    expect(() => retry(id, epoch)).toThrow()
    expect(workspaceWatchService.retry).not.toHaveBeenCalled()
    expect(record.mock.calls.map(([row]) => row.metadata.watchRetryStage)).toEqual(['received', 'context-rejected'])
    expect(record.mock.calls.every(([row]) => row.rawWorkspacePath === undefined)).toBe(true)
    expect(JSON.stringify(record.mock.calls)).not.toContain('/private/')
  })

  it('diagnostic writer failure cannot prevent an otherwise valid retry', () => {
    record.mockImplementationOnce(() => { throw new Error('writer unavailable') })
    expect(retry()).toEqual({ accepted: true })
    expect(workspaceWatchService.retry).toHaveBeenCalledTimes(1)
  })
})

describe('watch retry metadata privacy', () => {
  it.each(['received', 'context-rejected', 'subscriptions-selected', 'host-skipped', 'restart-requested'])('accepts the fixed stage %s', stage => {
    expect(sanitizeDiagnosticMetadata({ watchRetryStage: stage })).toEqual({ watchRetryStage: stage })
  })
  it.each(['no-subscriptions', 'shutting-down', 'stopping', 'cooldown'])('accepts the fixed early-return reason %s', reason => {
    expect(sanitizeDiagnosticMetadata({ watchRetryReason: reason })).toEqual({ watchRetryReason: reason })
  })
  it.each(['/private/business.md', 'arbitrary-error', 'user', null, true, 1])('rejects non-enum stage/reason %j', value => {
    expect(sanitizeDiagnosticMetadata({ watchRetryStage: value })).toBeNull()
    expect(sanitizeDiagnosticMetadata({ watchRetryReason: value })).toBeNull()
  })
})
