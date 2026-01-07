/**
 * SettingsPanel 组件单元测试
 * v1.3.4 - 右键菜单安装流程测试
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SettingsPanel } from '../../src/components/SettingsPanel'

// Mock window.api
global.window = {
  api: {
    checkContextMenuStatus: vi.fn(),
    installContextMenu: vi.fn(),
    uninstallContextMenu: vi.fn(),
    openSystemSettings: vi.fn(),
    confirmContextMenuEnabled: vi.fn()
  }
} as any

describe('SettingsPanel - 右键菜单安装流程', () => {
  const mockOnClose = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    // 默认未安装状态
    vi.mocked(window.api.checkContextMenuStatus).mockResolvedValue({
      installed: false,
      platform: 'darwin'
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('初始状态', () => {
    it('应该渲染设置面板', async () => {
      render(<SettingsPanel onClose={mockOnClose} />)

      await waitFor(() => {
        expect(screen.getByText('设置')).toBeInTheDocument()
        expect(screen.getByText('系统集成')).toBeInTheDocument()
      })
    })

    it('未安装状态应显示安装按钮', async () => {
      render(<SettingsPanel onClose={mockOnClose} />)

      await waitFor(() => {
        expect(screen.getByText('安装右键菜单')).toBeInTheDocument()
        expect(screen.getByText('状态：未安装')).toBeInTheDocument()
      })
    })

    it('未安装状态应显示使用说明', async () => {
      render(<SettingsPanel onClose={mockOnClose} />)

      await waitFor(() => {
        expect(screen.getByText('📖 使用说明')).toBeInTheDocument()
        expect(screen.getByText(/安装后，在 Finder 中右键点击/)).toBeInTheDocument()
      })
    })
  })

  describe('安装流程 - macOS', () => {
    it('安装成功后应显示启用引导模态框', async () => {
      vi.mocked(window.api.installContextMenu).mockResolvedValue({ success: true })
      vi.mocked(window.api.checkContextMenuStatus)
        .mockResolvedValueOnce({ installed: false, platform: 'darwin' })
        .mockResolvedValueOnce({ installed: true, platform: 'darwin', userConfirmedEnabled: false })

      render(<SettingsPanel onClose={mockOnClose} />)

      await waitFor(() => {
        expect(screen.getByText('安装右键菜单')).toBeInTheDocument()
      })

      const installBtn = screen.getByText('安装右键菜单')
      await userEvent.click(installBtn)

      await waitFor(() => {
        expect(screen.getByText('✅ 右键菜单安装成功！')).toBeInTheDocument()
        expect(screen.getByText('⚠️ 重要：需要在系统设置中启用')).toBeInTheDocument()
        expect(screen.getByText('打开系统设置')).toBeInTheDocument()
        expect(screen.getByText('我已完成启用')).toBeInTheDocument()
        expect(screen.getByText('稍后设置')).toBeInTheDocument()
      })
    })

    it('点击"打开系统设置"应调用正确的 API', async () => {
      vi.mocked(window.api.installContextMenu).mockResolvedValue({ success: true })
      vi.mocked(window.api.checkContextMenuStatus)
        .mockResolvedValueOnce({ installed: false, platform: 'darwin' })
        .mockResolvedValueOnce({ installed: true, platform: 'darwin', userConfirmedEnabled: false })
      vi.mocked(window.api.openSystemSettings).mockResolvedValue({ success: true })

      render(<SettingsPanel onClose={mockOnClose} />)

      await waitFor(() => {
        expect(screen.getByText('安装右键菜单')).toBeInTheDocument()
      })

      const installBtn = screen.getByText('安装右键菜单')
      await userEvent.click(installBtn)

      await waitFor(() => {
        expect(screen.getByText('打开系统设置')).toBeInTheDocument()
      })

      const openSettingsBtn = screen.getAllByText('打开系统设置')[0]
      await userEvent.click(openSettingsBtn)

      expect(window.api.openSystemSettings).toHaveBeenCalledWith('finder-extensions')
    })

    it('点击"我已完成启用"应更新状态并关闭模态框', async () => {
      vi.mocked(window.api.installContextMenu).mockResolvedValue({ success: true })
      vi.mocked(window.api.confirmContextMenuEnabled).mockResolvedValue({ success: true })
      vi.mocked(window.api.checkContextMenuStatus)
        .mockResolvedValueOnce({ installed: false, platform: 'darwin' })
        .mockResolvedValueOnce({ installed: true, platform: 'darwin', userConfirmedEnabled: false })
        .mockResolvedValueOnce({ installed: true, platform: 'darwin', userConfirmedEnabled: true })

      render(<SettingsPanel onClose={mockOnClose} />)

      await waitFor(() => {
        expect(screen.getByText('安装右键菜单')).toBeInTheDocument()
      })

      const installBtn = screen.getByText('安装右键菜单')
      await userEvent.click(installBtn)

      await waitFor(() => {
        expect(screen.getByText('我已完成启用')).toBeInTheDocument()
      })

      const confirmBtn = screen.getByText('我已完成启用')
      await userEvent.click(confirmBtn)

      expect(window.api.confirmContextMenuEnabled).toHaveBeenCalled()

      await waitFor(() => {
        expect(screen.queryByText('✅ 右键菜单安装成功！')).not.toBeInTheDocument()
      })
    })

    it('点击"稍后设置"应关闭模态框', async () => {
      vi.mocked(window.api.installContextMenu).mockResolvedValue({ success: true })
      vi.mocked(window.api.checkContextMenuStatus)
        .mockResolvedValueOnce({ installed: false, platform: 'darwin' })
        .mockResolvedValueOnce({ installed: true, platform: 'darwin', userConfirmedEnabled: false })

      render(<SettingsPanel onClose={mockOnClose} />)

      await waitFor(() => {
        expect(screen.getByText('安装右键菜单')).toBeInTheDocument()
      })

      const installBtn = screen.getByText('安装右键菜单')
      await userEvent.click(installBtn)

      await waitFor(() => {
        expect(screen.getByText('稍后设置')).toBeInTheDocument()
      })

      const skipBtn = screen.getByText('稍后设置')
      await userEvent.click(skipBtn)

      await waitFor(() => {
        expect(screen.queryByText('✅ 右键菜单安装成功！')).not.toBeInTheDocument()
      })
    })

    it('安装失败应显示错误信息', async () => {
      const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
      vi.mocked(window.api.installContextMenu).mockResolvedValue({
        success: false,
        error: '权限不足'
      })

      render(<SettingsPanel onClose={mockOnClose} />)

      await waitFor(() => {
        expect(screen.getByText('安装右键菜单')).toBeInTheDocument()
      })

      const installBtn = screen.getByText('安装右键菜单')
      await userEvent.click(installBtn)

      await waitFor(() => {
        expect(alertSpy).toHaveBeenCalledWith('安装失败: 权限不足')
      })

      alertSpy.mockRestore()
    })
  })

  describe('已安装待启用状态 - macOS', () => {
    beforeEach(() => {
      vi.mocked(window.api.checkContextMenuStatus).mockResolvedValue({
        installed: true,
        platform: 'darwin',
        userConfirmedEnabled: false
      })
    })

    it('应显示黄色状态指示器', async () => {
      render(<SettingsPanel onClose={mockOnClose} />)

      await waitFor(() => {
        expect(screen.getByText('状态：已安装，待启用')).toBeInTheDocument()
        expect(screen.getByText('⚠️ 请在系统设置中启用 Finder 扩展')).toBeInTheDocument()
      })
    })

    it('应显示三个按钮：打开系统设置、我已启用、卸载', async () => {
      render(<SettingsPanel onClose={mockOnClose} />)

      await waitFor(() => {
        expect(screen.getByText('打开系统设置')).toBeInTheDocument()
        expect(screen.getByText('我已启用')).toBeInTheDocument()
        expect(screen.getByText('卸载')).toBeInTheDocument()
      })
    })

    it('不应显示使用说明', async () => {
      render(<SettingsPanel onClose={mockOnClose} />)

      await waitFor(() => {
        expect(screen.queryByText('📖 使用说明')).not.toBeInTheDocument()
      })
    })
  })

  describe('已启用状态', () => {
    beforeEach(() => {
      vi.mocked(window.api.checkContextMenuStatus).mockResolvedValue({
        installed: true,
        platform: 'darwin',
        userConfirmedEnabled: true
      })
    })

    it('应显示绿色状态指示器', async () => {
      render(<SettingsPanel onClose={mockOnClose} />)

      await waitFor(() => {
        expect(screen.getByText('状态：已启用')).toBeInTheDocument()
      })
    })

    it('应只显示卸载按钮', async () => {
      render(<SettingsPanel onClose={mockOnClose} />)

      await waitFor(() => {
        expect(screen.getByText('卸载')).toBeInTheDocument()
        expect(screen.queryByText('打开系统设置')).not.toBeInTheDocument()
        expect(screen.queryByText('我已启用')).not.toBeInTheDocument()
      })
    })
  })

  describe('卸载流程', () => {
    beforeEach(() => {
      vi.mocked(window.api.checkContextMenuStatus).mockResolvedValue({
        installed: true,
        platform: 'darwin',
        userConfirmedEnabled: true
      })
    })

    it('macOS 卸载应显示警告并打开系统设置', async () => {
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
      vi.mocked(window.api.uninstallContextMenu).mockResolvedValue({ success: true })
      vi.mocked(window.api.openSystemSettings).mockResolvedValue({ success: true })
      vi.mocked(window.api.checkContextMenuStatus)
        .mockResolvedValueOnce({ installed: true, platform: 'darwin', userConfirmedEnabled: true })
        .mockResolvedValueOnce({ installed: false, platform: 'darwin' })

      render(<SettingsPanel onClose={mockOnClose} />)

      await waitFor(() => {
        expect(screen.getByText('卸载')).toBeInTheDocument()
      })

      const uninstallBtn = screen.getByText('卸载')
      await userEvent.click(uninstallBtn)

      expect(confirmSpy).toHaveBeenCalledWith(
        expect.stringContaining('请在系统设置中禁用 Finder 扩展')
      )

      await waitFor(() => {
        expect(window.api.uninstallContextMenu).toHaveBeenCalled()
        expect(window.api.openSystemSettings).toHaveBeenCalledWith('finder-extensions')
      })

      confirmSpy.mockRestore()
    })

    it('取消卸载不应执行卸载操作', async () => {
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)

      render(<SettingsPanel onClose={mockOnClose} />)

      await waitFor(() => {
        expect(screen.getByText('卸载')).toBeInTheDocument()
      })

      const uninstallBtn = screen.getByText('卸载')
      await userEvent.click(uninstallBtn)

      expect(window.api.uninstallContextMenu).not.toHaveBeenCalled()

      confirmSpy.mockRestore()
    })
  })

  describe('系统设置打开失败降级方案', () => {
    it('失败时应显示手动路径并复制到剪贴板', async () => {
      const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
      const clipboardSpy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()

      vi.mocked(window.api.installContextMenu).mockResolvedValue({ success: true })
      vi.mocked(window.api.openSystemSettings).mockResolvedValue({
        success: false,
        error: '无法打开'
      })
      vi.mocked(window.api.checkContextMenuStatus)
        .mockResolvedValueOnce({ installed: false, platform: 'darwin' })
        .mockResolvedValueOnce({ installed: true, platform: 'darwin', userConfirmedEnabled: false })

      render(<SettingsPanel onClose={mockOnClose} />)

      await waitFor(() => {
        expect(screen.getByText('安装右键菜单')).toBeInTheDocument()
      })

      const installBtn = screen.getByText('安装右键菜单')
      await userEvent.click(installBtn)

      await waitFor(() => {
        expect(screen.getByText('打开系统设置')).toBeInTheDocument()
      })

      const openSettingsBtn = screen.getAllByText('打开系统设置')[0]
      await userEvent.click(openSettingsBtn)

      await waitFor(() => {
        expect(alertSpy).toHaveBeenCalledWith(
          expect.stringContaining('无法自动打开系统设置')
        )
        expect(clipboardSpy).toHaveBeenCalledWith(
          '系统设置 → 隐私与安全性 → 扩展 → Finder 扩展'
        )
      })

      alertSpy.mockRestore()
      clipboardSpy.mockRestore()
    })
  })

  describe('Windows/Linux 平台', () => {
    it('Windows 安装成功不应显示引导模态框', async () => {
      vi.mocked(window.api.checkContextMenuStatus)
        .mockResolvedValueOnce({ installed: false, platform: 'win32' })
        .mockResolvedValueOnce({ installed: true, platform: 'win32' })
      vi.mocked(window.api.installContextMenu).mockResolvedValue({ success: true })

      render(<SettingsPanel onClose={mockOnClose} />)

      await waitFor(() => {
        expect(screen.getByText('安装右键菜单')).toBeInTheDocument()
      })

      const installBtn = screen.getByText('安装右键菜单')
      await userEvent.click(installBtn)

      await waitFor(() => {
        expect(window.api.installContextMenu).toHaveBeenCalled()
      })

      // 不应显示 macOS 特有的引导模态框
      expect(screen.queryByText('✅ 右键菜单安装成功！')).not.toBeInTheDocument()
    })

    it('Windows 已安装应直接显示已启用状态', async () => {
      vi.mocked(window.api.checkContextMenuStatus).mockResolvedValue({
        installed: true,
        platform: 'win32'
      })

      render(<SettingsPanel onClose={mockOnClose} />)

      await waitFor(() => {
        expect(screen.getByText('状态：已启用')).toBeInTheDocument()
      })
    })
  })

  describe('关闭面板', () => {
    it('点击关闭按钮应调用 onClose', async () => {
      render(<SettingsPanel onClose={mockOnClose} />)

      await waitFor(() => {
        expect(screen.getByText('×')).toBeInTheDocument()
      })

      const closeBtn = screen.getByText('×')
      await userEvent.click(closeBtn)

      expect(mockOnClose).toHaveBeenCalled()
    })

    it('点击遮罩层应调用 onClose', async () => {
      render(<SettingsPanel onClose={mockOnClose} />)

      await waitFor(() => {
        expect(screen.getByText('设置')).toBeInTheDocument()
      })

      const overlay = screen.getByText('设置').closest('.settings-overlay')!
      await userEvent.click(overlay)

      expect(mockOnClose).toHaveBeenCalled()
    })
  })
})
