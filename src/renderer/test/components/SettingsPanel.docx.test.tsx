import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsPanel } from '../../src/components/SettingsPanel'

const baseApi = {
  getAppSettings: vi.fn(),
  updateAppSettings: vi.fn(),
  checkContextMenuStatus: vi.fn(),
  testDocxConnection: vi.fn(),
  openExternal: vi.fn(),
  openSystemSettings: vi.fn(),
  confirmContextMenuEnabled: vi.fn(),
  getCliShimStatus: vi.fn(),
  installCliShim: vi.fn(),
  uninstallCliShim: vi.fn(),
}

describe('SettingsPanel DOCX service styles', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(window as any).api = {
      ...baseApi,
      getAppSettings: vi.fn().mockResolvedValue({
        maxRecentFiles: 20,
        maxFolderHistory: 10,
        showExportBranding: true,
        docxExport: {
          remoteEnabled: true,
          serverUrl: 'http://localhost:3179',
          style: 'official',
          styleTouched: true,
          timeoutMs: 180000,
          embedFont: false,
          localFallbackEnabled: false,
        },
      }),
      updateAppSettings: vi.fn().mockResolvedValue(undefined),
      checkContextMenuStatus: vi.fn().mockResolvedValue({
        installed: false,
        platform: 'darwin',
      }),
      getCliShimStatus: vi.fn().mockResolvedValue({
        supported: true,
        installed: false,
        platform: 'darwin',
      }),
      installCliShim: vi.fn().mockResolvedValue({
        ok: true,
        path: '/Users/tester/.local/bin/md-viewer',
        nextStep: '重新打开终端后可直接运行：md-viewer capabilities --json',
      }),
      uninstallCliShim: vi.fn().mockResolvedValue({
        ok: true,
        nextStep: '重新打开终端后，md-viewer 命令将不再可用。',
      }),
      testDocxConnection: vi.fn().mockResolvedValue({
        ok: true,
        version: '0.1.0',
        mode: 'full',
        styles: ['official', 'internal', 'report', 'standard'],
        embedFontSupported: false,
        chartRenderersAvailable: ['mermaid'],
      }),
    }
  })

  it('disables preview style without showing a warning for a supported active style', async () => {
    render(<SettingsPanel onClose={vi.fn()} />)

    fireEvent.click(screen.getByRole('tab', { name: '导出' }))

    await waitFor(() => {
      expect(screen.getByDisplayValue('http://localhost:3179')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: '测试' }))

    await waitFor(() => {
      expect(screen.getByText('v0.1.0 · full · 4 种样式可用')).toBeInTheDocument()
    })

    expect(screen.getByText('当前服务未提供“预览一致”，该样式已禁用；当前选择“正式公文”可导出。')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /预览一致/ })).toBeDisabled()
    expect(screen.getByRole('radio', { name: /正式公文/ })).toBeChecked()
    expect(screen.queryByText(/当前服务不支持“正式公文”/)).not.toBeInTheDocument()
  })

  it('shows renderer capability matrix with new RendererPlugin types', async () => {
    render(<SettingsPanel onClose={vi.fn()} />)

    fireEvent.click(screen.getByRole('tab', { name: '图表' }))

    await waitFor(() => {
      expect(screen.getByText('渲染能力')).toBeInTheDocument()
    })

    expect(screen.getByText('Vega-Lite')).toBeInTheDocument()
    expect(screen.getByText('D2')).toBeInTheDocument()
    expect(screen.getByText('BPMN')).toBeInTheDocument()
    expect(screen.getByText('WaveDrom')).toBeInTheDocument()
    expect(screen.getByText('C4-PlantUML')).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: '应用预览' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'HTML/PDF' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'DOCX' })).toBeInTheDocument()
  })

  it('splits settings into task-focused tabs', async () => {
    render(<SettingsPanel onClose={vi.fn()} />)

    expect(screen.getByRole('tablist', { name: '设置分类' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '外观' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel', { name: '外观' })).toBeInTheDocument()
    expect(screen.getByText('主题')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: '浏览' }))
    expect(screen.getByRole('tabpanel', { name: '浏览' })).toBeInTheDocument()
    expect(screen.getByText('最近文件上限')).toBeInTheDocument()
    expect(screen.getByText('文件夹历史上限')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: '导出' }))
    await waitFor(() => {
      expect(screen.getByRole('tabpanel', { name: '导出' })).toBeInTheDocument()
      expect(screen.getByText('DOCX 导出服务')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('tab', { name: '图表' }))
    expect(screen.getByRole('tabpanel', { name: '图表' })).toBeInTheDocument()
    expect(screen.getByText('PlantUML 服务器')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: '系统' }))
    await waitFor(() => {
      expect(screen.getByRole('tabpanel', { name: '系统' })).toBeInTheDocument()
      expect(screen.getByText('右键菜单集成')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('tab', { name: '关于' }))
    expect(screen.getByRole('tabpanel', { name: '关于' })).toBeInTheDocument()
    expect(screen.getByText('版本更新')).toBeInTheDocument()
  })

  it('在系统设置中按 CLI 安装状态互斥显示安装或卸载入口', async () => {
    vi.mocked(window.api.getCliShimStatus)
      .mockResolvedValueOnce({
        supported: true,
        installed: false,
        platform: 'darwin',
      })
      .mockResolvedValueOnce({
        supported: true,
        installed: true,
        platform: 'darwin',
        path: '/Users/tester/.local/bin/md-viewer',
        pathInShell: true,
        ownedByMdViewer: true,
      })

    render(<SettingsPanel onClose={vi.fn()} />)

    fireEvent.click(screen.getByRole('tab', { name: '系统' }))

    await waitFor(() => {
      expect(screen.getByText('命令行工具')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: '安装命令行工具' })).toBeInTheDocument()
    })
    expect(screen.queryByRole('button', { name: '卸载命令行工具' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '安装命令行工具' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '卸载命令行工具' })).toBeInTheDocument()
    })
    expect(screen.queryByRole('button', { name: '安装命令行工具' })).not.toBeInTheDocument()
  })
})
