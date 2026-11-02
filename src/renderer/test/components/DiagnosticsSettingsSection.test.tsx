import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DiagnosticLogStatus } from '../../../shared/diagnostics'
import { DiagnosticsSettingsSection } from '../../src/components/settings/DiagnosticsSettingsSection'

function status(overrides: Partial<DiagnosticLogStatus> = {}): DiagnosticLogStatus {
  return {
    state: 'ready',
    enabled: true,
    configuredDirectory: null,
    effectiveDirectory: '/Users/example/Library/Logs/MD Viewer',
    defaultDirectory: '/Users/example/Library/Logs/MD Viewer',
    usingCustomDirectory: false,
    usingFallback: false,
    maxTotalMiB: 10,
    retentionDays: 7,
    fileCount: 4,
    totalBytes: 1024 * 1024,
    oldestEventUnixMs: Date.now() - 2 * 24 * 60 * 60 * 1000,
    effectiveCoverageDays: 2,
    droppedEvents: 0,
    invalidEvents: 0,
    pathCorrelation: 'installation',
    capabilities: {
      canChooseDirectory: true,
      canRetryDirectory: false,
      canResetDirectory: false,
      canOpenDirectory: true,
      canApplyRetention: true,
      canExportBundle: true,
      canClearLogs: true,
    },
    ...overrides,
  }
}

function apiMock(initial = status()) {
  return {
    getDiagnosticLogStatus: vi.fn().mockResolvedValue(initial),
    setDiagnosticLoggingEnabled: vi.fn().mockResolvedValue(initial),
    chooseDiagnosticLogDirectory: vi.fn().mockResolvedValue({ canceled: true, status: initial }),
    retryDiagnosticLogDirectory: vi.fn().mockResolvedValue({ canceled: false, status: initial }),
    resetDiagnosticLogDirectory: vi.fn().mockResolvedValue({ canceled: false, status: initial }),
    openDiagnosticLogDirectory: vi.fn().mockResolvedValue({ success: true }),
    applyDiagnosticRetentionPolicy: vi.fn().mockResolvedValue({
      canceled: false,
      applied: true,
      status: initial,
    }),
    clearDiagnosticLogs: vi.fn().mockResolvedValue({
      canceled: false,
      deletedFiles: 4,
      deletedBytes: 1024 * 1024,
      skippedActiveFiles: 0,
      partial: false,
      status: status({ fileCount: 0, totalBytes: 0, oldestEventUnixMs: null }),
    }),
    exportDiagnosticsBundle: vi.fn().mockResolvedValue({ canceled: true }),
    showItemInFolder: vi.fn().mockResolvedValue({ success: true }),
  }
}

describe('DiagnosticsSettingsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    })
  })

  it('先显示加载状态，再显示默认路径和日志占用', async () => {
    const api = apiMock()
    ;(window as any).api = api
    render(<DiagnosticsSettingsSection />)

    expect(screen.getByText('正在读取诊断日志状态…')).toBeInTheDocument()
    expect(await screen.findByText('正在记录诊断事件 · 使用默认位置')).toBeInTheDocument()
    expect(screen.getByText('/Users/example/Library/Logs/MD Viewer')).toBeInTheDocument()
    expect(screen.getByText(/当前日志：4 个文件/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '恢复默认位置' })).not.toBeInTheDocument()
  })

  it('关闭只停止新事件，仍保留打开、导出和清除操作', async () => {
    const disabled = status({ state: 'disabled', enabled: false })
    const api = apiMock(disabled)
    ;(window as any).api = api
    render(<DiagnosticsSettingsSection />)

    expect(await screen.findByText('已停止记录。已有日志仍可打开、导出或清除。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '打开日志文件夹' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '导出诊断包' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '清除日志…' })).toBeEnabled()
  })

  it('容量和天数作为一个草稿一次提交', async () => {
    const initial = status()
    const updated = status({ maxTotalMiB: 25, retentionDays: 14 })
    const api = apiMock(initial)
    api.applyDiagnosticRetentionPolicy.mockResolvedValue({
      canceled: false,
      applied: true,
      status: updated,
    })
    ;(window as any).api = api
    render(<DiagnosticsSettingsSection />)
    await screen.findByText('正在记录诊断事件 · 使用默认位置')

    fireEvent.change(screen.getByLabelText('日志总大小上限'), { target: { value: '25' } })
    fireEvent.change(screen.getByLabelText('保留时间'), { target: { value: '14' } })
    expect(screen.getByText('新规则尚未应用')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '应用规则' }))

    await waitFor(() => {
      expect(api.applyDiagnosticRetentionPolicy).toHaveBeenCalledTimes(1)
      expect(api.applyDiagnosticRetentionPolicy).toHaveBeenCalledWith({
        maxTotalMiB: 25,
        retentionDays: 14,
      })
    })
    expect(await screen.findByText('自动清理规则已更新。')).toBeInTheDocument()
  })

  it('fallback 同时显示配置位置和当前写入位置', async () => {
    const fallback = status({
      state: 'fallback',
      configuredDirectory: '/Volumes/Offline/MD Viewer Logs',
      effectiveDirectory: '/Users/example/Library/Logs/MD Viewer',
      usingFallback: true,
      capabilities: {
        ...status().capabilities,
        canRetryDirectory: true,
        canResetDirectory: true,
      },
    })
    const api = apiMock(fallback)
    ;(window as any).api = api
    render(<DiagnosticsSettingsSection />)

    expect(await screen.findByText('自定义位置当前不可用，新日志已临时写入默认位置。')).toBeInTheDocument()
    expect(screen.getByText('配置位置')).toBeInTheDocument()
    expect(screen.getByText('/Volumes/Offline/MD Viewer Logs')).toBeInTheDocument()
    expect(screen.getByText('当前写入位置')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重试自定义位置' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '恢复默认位置' })).toBeInTheDocument()
  })

  it('清除后报告实际文件数和字节数，不宣称日志为空', async () => {
    const api = apiMock()
    ;(window as any).api = api
    render(<DiagnosticsSettingsSection />)
    await screen.findByText('正在记录诊断事件 · 使用默认位置')

    fireEvent.click(screen.getByRole('button', { name: '清除日志…' }))

    expect(await screen.findByText('已清除 4 个文件，共 1.0 MiB。')).toBeInTheDocument()
    expect(screen.queryByText('当前没有日志')).not.toBeInTheDocument()
  })
})
