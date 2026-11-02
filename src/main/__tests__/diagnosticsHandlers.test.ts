import { describe, expect, it, vi } from 'vitest'
import { BrowserWindow, dialog, ipcMain } from 'electron'
import { registerDiagnosticsHandlers } from '../ipc/diagnosticsHandlers'
import { createDiagnosticsBundle } from '../diagnostics/DiagnosticsService'

vi.mock('../diagnostics/DiagnosticsService', async importOriginal => {
  const actual = await importOriginal<typeof import('../diagnostics/DiagnosticsService')>()
  return { ...actual, createDiagnosticsBundle: vi.fn(actual.createDiagnosticsBundle) }
})

vi.mock('electron', () => ({
  app: {
    getVersion: vi.fn(() => '2.8.0'),
    isPackaged: false,
  },
  BrowserWindow: { fromWebContents: vi.fn() },
  dialog: {
    showSaveDialog: vi.fn(),
    showOpenDialog: vi.fn(),
    showMessageBox: vi.fn(),
  },
  shell: { openPath: vi.fn() },
  ipcMain: { handle: vi.fn(), on: vi.fn() },
}))

function diagnosticEventLogMock() {
  return {
    readEventsForBundle: vi.fn(async () => ({
      events: [],
      totalBytes: 0,
      invalidLines: 0,
      truncated: false,
      omittedFiles: 0,
      oldestEventUnixMs: null,
      newestEventUnixMs: null,
    })),
    getHealth: vi.fn(() => ({
      eventsAccepted: 0,
      eventsWritten: 0,
      invalidEvents: 0,
      droppedEvents: 0,
      bytesWritten: 0,
      batchCount: 0,
      appendP95Ms: 0,
      appendMaxMs: 0,
      queueLagP95Ms: 0,
      queueLagMaxMs: 0,
      maxQueueBytes: 0,
      cleanupDurationMs: 0,
      destinationFallbacks: 0,
      writerWriteActive: false,
    })),
  }
}

function getHandler(channel = 'diagnostics:exportBundle') {
  const call = vi.mocked(ipcMain.handle).mock.calls.find(([registeredChannel]) => registeredChannel === channel)
  if (!call) throw new Error('missing diagnostics handler')
  return call[1] as (...args: any[]) => Promise<any>
}

describe('diagnostics IPC', () => {
  it('取消保存对话框时零输出', async () => {
    vi.clearAllMocks()
    const window = { id: 1 } as Electron.BrowserWindow
    vi.mocked(BrowserWindow.fromWebContents).mockReturnValue(window)
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: true, filePath: '' })
    const ctx = {
      windowManager: {
        listWorkspaces: vi.fn(() => []),
        getActiveWorkspace: vi.fn(() => undefined),
        getWindowCount: vi.fn(() => 1),
        getWorkspacePresentation: vi.fn(() => undefined),
      },
      appDataManager: { getSettings: vi.fn(() => ({})) },
      diagnosticEventLogService: diagnosticEventLogMock(),
    }
    registerDiagnosticsHandlers(ctx as any)

    const result = await getHandler()({ sender: { id: 9 } })

    expect(result).toEqual({ canceled: true })
    expect(dialog.showSaveDialog).toHaveBeenCalledWith(window, expect.objectContaining({
      title: '保存 MD Viewer 诊断包',
    }))
  })

  it('生成失败时返回受限错误而不是把 IPC 直接 reject', async () => {
    vi.clearAllMocks()
    const window = { id: 1 } as Electron.BrowserWindow
    vi.mocked(BrowserWindow.fromWebContents).mockReturnValue(window)
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: false, filePath: '/tmp/diagnostics.zip' })
    vi.mocked(createDiagnosticsBundle).mockRejectedValueOnce(Object.assign(new Error('private path details'), {
      code: 'EACCES',
    }))
    const ctx = {
      windowManager: {
        listWorkspaces: vi.fn(() => []),
        getActiveWorkspace: vi.fn(() => undefined),
        getWindowCount: vi.fn(() => 1),
        getWorkspacePresentation: vi.fn(() => undefined),
      },
      appDataManager: { getSettings: vi.fn(() => ({})) },
      diagnosticEventLogService: diagnosticEventLogMock(),
    }
    registerDiagnosticsHandlers(ctx as any)

    const result = await getHandler()({ sender: { id: 9 } })

    expect(result).toEqual({
      canceled: false,
      error: {
        code: 'OUTPUT_NOT_WRITABLE',
        message: '无法写入所选位置，请更换保存位置后重试。',
      },
    })
    expect(JSON.stringify(result)).not.toContain('private path details')
  })

  it('目录只能来自主进程选择器，忽略 renderer 追加的路径参数', async () => {
    vi.clearAllMocks()
    const window = { id: 1 } as Electron.BrowserWindow
    vi.mocked(BrowserWindow.fromWebContents).mockReturnValue(window)
    vi.mocked(dialog.showOpenDialog).mockResolvedValue({
      canceled: false,
      filePaths: ['/selected/logs'],
    })
    const service = {
      validateCustomDirectory: vi.fn().mockResolvedValue('/canonical/logs'),
      applyConfiguredDirectory: vi.fn().mockResolvedValue(undefined),
      getStatus: vi.fn().mockResolvedValue({ state: 'ready' }),
    }
    const appDataManager = {
      getDiagnosticLogSettings: vi.fn(() => ({ enabled: true, maxTotalMiB: 10, retentionDays: 7 })),
      setDiagnosticLogSettings: vi.fn(value => value),
    }
    registerDiagnosticsHandlers({
      windowManager: {},
      appDataManager,
      diagnosticEventLogService: service,
    } as any)

    const result = await getHandler('diagnostics:chooseLogDirectory')(
      { sender: { id: 9 } },
      '/renderer/attacker-path',
    )

    expect(result.canceled).toBe(false)
    expect(service.validateCustomDirectory).toHaveBeenCalledWith('/selected/logs')
    expect(service.validateCustomDirectory).not.toHaveBeenCalledWith('/renderer/attacker-path')
    expect(appDataManager.setDiagnosticLogSettings).toHaveBeenCalledWith(expect.objectContaining({
      directory: '/canonical/logs',
    }))
  })

  it('组合保留规则需要删除时只确认一次，取消后不保存', async () => {
    vi.clearAllMocks()
    const window = { id: 1 } as Electron.BrowserWindow
    vi.mocked(BrowserWindow.fromWebContents).mockReturnValue(window)
    vi.mocked(dialog.showMessageBox).mockResolvedValue({ response: 0, checkboxChecked: false })
    const service = {
      previewRetentionPolicy: vi.fn().mockResolvedValue({
        files: [{ path: '/logs/old.jsonl' }],
        bytes: 3 * 1024 * 1024,
        skippedActiveFiles: 0,
      }),
      getStatus: vi.fn().mockResolvedValue({ state: 'ready' }),
      applyRetentionPolicy: vi.fn(),
    }
    const appDataManager = {
      getDiagnosticLogSettings: vi.fn(),
      setDiagnosticLogSettings: vi.fn(),
    }
    registerDiagnosticsHandlers({
      windowManager: {},
      appDataManager,
      diagnosticEventLogService: service,
    } as any)

    const result = await getHandler('diagnostics:applyRetentionPolicy')(
      { sender: { id: 9 } },
      { maxTotalMiB: 10, retentionDays: 7 },
    )

    expect(result).toMatchObject({ canceled: true, applied: false })
    expect(dialog.showMessageBox).toHaveBeenCalledTimes(1)
    expect(appDataManager.setDiagnosticLogSettings).not.toHaveBeenCalled()
    expect(service.applyRetentionPolicy).not.toHaveBeenCalled()
  })

  it('拒绝 renderer 提交任意保留值', async () => {
    vi.clearAllMocks()
    const window = { id: 1 } as Electron.BrowserWindow
    vi.mocked(BrowserWindow.fromWebContents).mockReturnValue(window)
    registerDiagnosticsHandlers({
      windowManager: {},
      appDataManager: {},
      diagnosticEventLogService: {},
    } as any)

    await expect(getHandler('diagnostics:applyRetentionPolicy')(
      { sender: { id: 9 } },
      { maxTotalMiB: 999, retentionDays: 0 },
    )).rejects.toThrow('无效的诊断日志保留规则')
  })
})
