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
})
