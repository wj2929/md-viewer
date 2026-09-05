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
  dialog: { showSaveDialog: vi.fn() },
  ipcMain: { handle: vi.fn() },
}))

function getHandler() {
  const call = vi.mocked(ipcMain.handle).mock.calls.find(([channel]) => channel === 'diagnostics:exportBundle')
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
})
