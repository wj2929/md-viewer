import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom'
import { FolderHistoryDropdown } from '../../src/components/FolderHistoryDropdown'
import { useFolderSearchSettingsStore } from '../../src/stores/folderSearchSettingsStore'

const mockFolders = [
  {
    id: 'history-fixtures',
    path: '/Users/test/Documents/projects/md-viewer/e2e/fixtures',
    name: 'fixtures',
    lastOpened: Date.now() - 5 * 60 * 1000,
  },
  {
    id: 'history-live',
    path: '/Users/test/Documents/examples/资料目录',
    name: '资料目录',
    lastOpened: Date.now() - 2 * 60 * 60 * 1000,
  },
  {
    id: 'history-docs',
    path: '/Users/test/Documents/projects/sample-app/identity/docs',
    name: 'docs',
    lastOpened: Date.now() - 3 * 24 * 60 * 60 * 1000,
  },
]

describe('FolderHistoryDropdown', () => {
  const onSelectFolder = vi.fn()
  const onOpenFolder = vi.fn()
  const getFolderHistory = vi.fn()
  const removeFolderFromHistory = vi.fn()
  const clearFolderHistory = vi.fn()
  const showRecentFolderContextMenu = vi.fn()

  beforeEach(() => {
    useFolderSearchSettingsStore.setState({ hydration: 'idle', enabled: false, pending: null, saving: false, hasLoaded: false, error: null, revision: 0 })
    onSelectFolder.mockClear()
    onOpenFolder.mockClear()
    getFolderHistory.mockResolvedValue(mockFolders)
    removeFolderFromHistory.mockResolvedValue(undefined)
    clearFolderHistory.mockResolvedValue(undefined)
    showRecentFolderContextMenu.mockResolvedValue({ success: true })

    window.api = {
      ...(window.api || {}),
      getAppSettings: vi.fn().mockResolvedValue({}),
      updateAppSettings: vi.fn().mockResolvedValue(undefined),
      getFolderHistory,
      removeFolderFromHistory,
      clearFolderHistory,
      showRecentFolderContextMenu,
      platform: 'darwin',
    } as any
  })

  it('历史异步加载后聚焦搜索框，重新打开恢复焦点且不抢走用户后续选择', async () => {
    let resolveHistory!: (items: typeof mockFolders) => void
    getFolderHistory.mockReturnValue(new Promise<typeof mockFolders>(resolve => { resolveHistory = resolve }))
    const user = userEvent.setup()
    render(<FolderHistoryDropdown onSelectFolder={onSelectFolder} onOpenFolder={onOpenFolder} />)
    const trigger = screen.getByRole('button', { name: '最近打开的文件夹' })
    await user.click(trigger)
    expect(screen.queryByRole('searchbox', { name: '搜索最近文件夹' })).toBeNull()
    await act(async () => { resolveHistory(mockFolders) })
    const input = screen.getByRole('searchbox', { name: '搜索最近文件夹' })
    expect(input).toHaveFocus()
    await user.keyboard('identity')
    expect(input).toHaveValue('identity')
    expect(screen.getByText('docs')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(trigger).toHaveFocus()
    await user.click(trigger)
    expect(screen.getByRole('searchbox', { name: '搜索最近文件夹' })).toHaveFocus()
    expect(screen.getByRole('searchbox', { name: '搜索最近文件夹' })).toHaveValue('identity')
    const checkbox = screen.getByRole('checkbox', { name: '拼音搜索' })
    await user.click(checkbox)
    await waitFor(() => expect(checkbox).not.toBeDisabled())
    expect(checkbox).toHaveFocus()
    expect(onSelectFolder).not.toHaveBeenCalled()
  })

  it('按名称或路径搜索最近文件夹并显示匹配结果', async () => {
    render(<FolderHistoryDropdown onSelectFolder={onSelectFolder} onOpenFolder={onOpenFolder} />)

    await userEvent.click(screen.getByLabelText('最近打开的文件夹'))

    await waitFor(() => {
      expect(screen.getByText('fixtures')).toBeInTheDocument()
      expect(screen.getByText('资料目录')).toBeInTheDocument()
    })

    const searchInput = screen.getByPlaceholderText('搜索最近文件夹...')
    await userEvent.type(searchInput, 'identity')

    expect(screen.queryByText('fixtures')).not.toBeInTheDocument()
    expect(screen.queryByText('资料目录')).not.toBeInTheDocument()
    expect(screen.getByText('docs')).toBeInTheDocument()
    expect(screen.getByText('~/Documents/projects/sample-app/identity/docs')).toBeInTheDocument()
  })

  it('右键菜单只向主进程发送文件夹历史 ID', async () => {
    render(<FolderHistoryDropdown onSelectFolder={onSelectFolder} onOpenFolder={onOpenFolder} />)
    await userEvent.click(screen.getByLabelText('最近打开的文件夹'))
    await waitFor(() => expect(screen.getByText('fixtures')).toBeInTheDocument())

    fireEvent.contextMenu(screen.getByText('fixtures').closest('.history-item')!)

    expect(showRecentFolderContextMenu).toHaveBeenCalledWith('history-fixtures')
  })

  it('没有匹配结果时显示空状态，并支持清空历史', async () => {
    render(<FolderHistoryDropdown onSelectFolder={onSelectFolder} onOpenFolder={onOpenFolder} />)

    await userEvent.click(screen.getByLabelText('最近打开的文件夹'))
    await waitFor(() => expect(screen.getByText('fixtures')).toBeInTheDocument())

    await userEvent.type(screen.getByPlaceholderText('搜索最近文件夹...'), 'not-found')
    expect(screen.getByText('未找到匹配文件夹')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '清空最近文件夹' }))

    expect(clearFolderHistory).toHaveBeenCalledTimes(1)
    expect(screen.getByText('暂无最近打开的文件夹')).toBeInTheDocument()
  })

  it('默认关闭，启用后三字母前缀默认5条，第6条可键盘选择且不显示常驻说明', async () => {
    getFolderHistory.mockResolvedValue(Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, name: '研发中心', path: `/fixture/${i}`, lastOpened: i })))
    render(<FolderHistoryDropdown onSelectFolder={onSelectFolder} onOpenFolder={onOpenFolder} />)
    await userEvent.click(screen.getByLabelText('最近打开的文件夹'))
    const checkbox = screen.getByRole('checkbox', { name: '拼音搜索' })
    await waitFor(() => expect(checkbox).not.toBeDisabled())
    fireEvent.change(screen.getByLabelText('搜索最近文件夹'), { target: { value: 'yan' } })
    expect(screen.queryByText('研发中心')).toBeNull()
    expect(screen.queryByText(/仅目录名称全拼|重启后保留|两入口共用/)).toBeNull()
    await userEvent.click(checkbox)
    await screen.findByText(/拼音匹配 · 前 5 \/ 6/)
    expect(screen.getAllByText('研发中心')).toHaveLength(5)
    expect(window.api.updateAppSettings).toHaveBeenCalledWith({ folderPinyinSearchEnabled: true })
    await userEvent.click(screen.getByRole('button', { name: '显示其余 1 项' }))
    expect(screen.getAllByText('研发中心')).toHaveLength(6)
    const sixth = screen.getAllByText('研发中心')[5].closest('.history-item')!
    await act(async () => { fireEvent.keyDown(sixth, { key: 'Enter' }) })
    expect(onSelectFolder).toHaveBeenCalledWith('p5')
  })

  it('原文字面结果优先，补充分组折叠，右键和移除只使用原ID', async () => {
    getFolderHistory.mockResolvedValue([
      { id: 'pinyin', name: '研发中心', path: '/fixture/研发中心', lastOpened: 1 },
      { id: 'literal', name: 'yanfa-tools', path: '/fixture/yanfa-tools', lastOpened: 2 },
    ])
    vi.mocked(window.api.getAppSettings).mockResolvedValue({ folderPinyinSearchEnabled: true } as any)
    render(<FolderHistoryDropdown onSelectFolder={onSelectFolder} onOpenFolder={onOpenFolder} />)
    await userEvent.click(screen.getByLabelText('最近打开的文件夹'))
    await waitFor(() => expect(screen.getByRole('checkbox', { name: '拼音搜索' })).toBeChecked())
    fireEvent.change(screen.getByLabelText('搜索最近文件夹'), { target: { value: 'yanfa' } })
    const toggle = await screen.findByRole('button', { name: /拼音补充 · 1/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText('yanfa-tools')).toBeInTheDocument()
    expect(screen.queryByText('研发中心')).toBeNull()
    await userEvent.click(toggle)
    fireEvent.contextMenu(screen.getByText('研发中心').closest('.history-item')!)
    expect(showRecentFolderContextMenu).toHaveBeenCalledWith('pinyin')
    await userEvent.click(screen.getByRole('button', { name: '从历史中移除 研发中心' }))
    expect(removeFolderFromHistory).toHaveBeenCalledWith('pinyin')
    expect(onSelectFolder).not.toHaveBeenCalled()
    expect(screen.queryByText('研发中心')).toBeNull()
  })

  it('保存失败恢复开关，IME确认键不选择目录，Escape回到入口', async () => {
    render(<FolderHistoryDropdown onSelectFolder={onSelectFolder} onOpenFolder={onOpenFolder} />)
    const trigger = screen.getByLabelText('最近打开的文件夹')
    await userEvent.click(trigger)
    const input = screen.getByLabelText('搜索最近文件夹')
    await waitFor(() => expect(screen.getByRole('checkbox', { name: '拼音搜索' })).not.toBeDisabled())
    vi.mocked(window.api.updateAppSettings).mockRejectedValueOnce(new Error('fixture save error'))
    await userEvent.click(screen.getByRole('checkbox', { name: '拼音搜索' }))
    expect(await screen.findByText('设置未保存，请重试')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: '拼音搜索' })).not.toBeChecked()
    fireEvent.compositionStart(input)
    fireEvent.change(input, { target: { value: 'fixtures' } })
    fireEvent.keyDown(screen.getByText('fixtures').closest('.history-item')!, { key: 'Enter', isComposing: true })
    expect(onSelectFolder).not.toHaveBeenCalled()
    fireEvent.compositionEnd(input)
    input.focus()
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByLabelText('搜索最近文件夹')).toBeNull()
    expect(trigger).toHaveFocus()
  })

})
