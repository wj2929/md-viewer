import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom'
import { RecentFilesDropdown } from '../../src/components/RecentFilesDropdown'
import { useFolderSearchSettingsStore } from '../../src/stores/folderSearchSettingsStore'

const mockFiles = [
  {
    id: 'recent-cli',
    path: '/Users/test/Documents/projects/md-viewer/docs/cli.md',
    name: 'cli.md',
    folderPath: '/Users/test/Documents/projects/md-viewer/docs',
    lastOpened: Date.now() - 5 * 60 * 1000,
  },
  {
    id: 'recent-live',
    path: '/Users/test/Documents/examples/资料目录/示例说明.md',
    name: '示例说明.md',
    folderPath: '/Users/test/Documents/examples/资料目录',
    lastOpened: Date.now() - 2 * 60 * 60 * 1000,
  },
  {
    id: 'recent-apisix',
    path: '/Users/test/Documents/projects/sample-app/identity/docs/apisix-cors-config.md',
    name: 'apisix-cors-config.md',
    folderPath: '/Users/test/Documents/projects/sample-app/identity/docs',
    lastOpened: Date.now() - 3 * 24 * 60 * 60 * 1000,
  },
]

describe('RecentFilesDropdown', () => {
  const onSelectFile = vi.fn()
  const getRecentFiles = vi.fn()
  const removeRecentFile = vi.fn()
  const clearRecentFiles = vi.fn()
  const onRecentFileRemove = vi.fn()
  const showRecentFileContextMenu = vi.fn()
  const readFilePreview = vi.fn()

  beforeEach(() => {
    useFolderSearchSettingsStore.setState({ hydration: 'idle', enabled: false, pending: null, saving: false, hasLoaded: false, error: null, revision: 0 })
    onSelectFile.mockClear()
    getRecentFiles.mockResolvedValue(mockFiles)
    removeRecentFile.mockResolvedValue(undefined)
    clearRecentFiles.mockResolvedValue(undefined)
    onRecentFileRemove.mockReturnValue(() => undefined)
    showRecentFileContextMenu.mockResolvedValue({ success: true })
    readFilePreview.mockResolvedValue('')

    window.api = {
      ...(window.api || {}),
      getAppSettings: vi.fn().mockResolvedValue({}),
      updateAppSettings: vi.fn().mockResolvedValue(undefined),
      getRecentFiles,
      removeRecentFile,
      clearRecentFiles,
      onRecentFileRemove,
      showRecentFileContextMenu,
      readFilePreview,
      platform: 'darwin',
    } as any
  })

  it('按文件名或路径搜索最近文件并显示匹配结果', async () => {
    render(<RecentFilesDropdown onSelectFile={onSelectFile} />)

    await userEvent.click(screen.getByRole('button', { name: '最近打开的文件' }))

    await waitFor(() => {
      expect(screen.getByText('cli.md')).toBeInTheDocument()
      expect(screen.getByText('示例说明.md')).toBeInTheDocument()
    })

    await userEvent.type(screen.getByPlaceholderText('搜索最近文件...'), 'identity')

    expect(screen.queryByText('cli.md')).not.toBeInTheDocument()
    expect(screen.queryByText('示例说明.md')).not.toBeInTheDocument()
    expect(screen.getByText('apisix-cors-config.md')).toBeInTheDocument()
    expect(screen.getByText('~/Documents/projects/sample-app/identity/docs')).toBeInTheDocument()
  })

  it('右键菜单只向主进程发送最近文件 ID', async () => {
    render(<RecentFilesDropdown onSelectFile={onSelectFile} />)
    await userEvent.click(screen.getByRole('button', { name: '最近打开的文件' }))
    await waitFor(() => expect(screen.getByText('cli.md')).toBeInTheDocument())

    fireEvent.contextMenu(screen.getByText('cli.md').closest('.recent-file-item')!)

    expect(showRecentFileContextMenu).toHaveBeenCalledWith('recent-cli')
  })

  it('没有匹配结果时显示空状态，并支持清空历史', async () => {
    render(<RecentFilesDropdown onSelectFile={onSelectFile} />)

    await userEvent.click(screen.getByRole('button', { name: '最近打开的文件' }))
    await waitFor(() => expect(screen.getByText('cli.md')).toBeInTheDocument())

    await userEvent.type(screen.getByPlaceholderText('搜索最近文件...'), 'not-found')
    expect(screen.getByText('未找到匹配文件')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '清空最近文件' }))

    expect(clearRecentFiles).toHaveBeenCalledTimes(1)
    expect(screen.getByText('暂无最近打开的文件')).toBeInTheDocument()
  })

  it('默认关闭，启用后按文件名拼音补充，第6项可用原ID键盘打开', async () => {
    getRecentFiles.mockResolvedValue(Array.from({ length: 6 }, (_, i) => ({
      id: `p${i}`, name: '研发报告.md', path: `/fixture/group${i}/研发报告.md`,
      folderPath: `/fixture/group${i}`, lastOpened: i,
    })))
    render(<RecentFilesDropdown onSelectFile={onSelectFile} />)
    await userEvent.click(screen.getByRole('button', { name: '最近打开的文件' }))
    const checkbox = screen.getByRole('checkbox', { name: '拼音搜索' })
    await waitFor(() => expect(checkbox).toBeEnabled())
    expect(checkbox).not.toBeChecked()
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索最近文件' }), { target: { value: 'yanf' } })
    expect(screen.queryByText('研发报告.md')).toBeNull()
    await userEvent.click(checkbox)
    await screen.findByText(/拼音匹配 · 前 5 \/ 6/)
    expect(screen.getAllByText('研发报告.md')).toHaveLength(5)
    expect(window.api.updateAppSettings).toHaveBeenCalledWith({ folderPinyinSearchEnabled: true })
    await userEvent.click(screen.getByRole('button', { name: '显示其余 1 项' }))
    expect(screen.getAllByText('研发报告.md')).toHaveLength(6)
    const sixth = screen.getAllByText('研发报告.md')[5].closest('.recent-file-item')!
    await act(async () => { fireEvent.keyDown(sixth, { key: 'Enter' }) })
    expect(onSelectFile).toHaveBeenCalledExactlyOnceWith('p5')
    expect(screen.queryByRole('searchbox', { name: '搜索最近文件' })).toBeNull()
  })

  it('原文字面结果优先，拼音分组折叠，右键和移除保留原有参数', async () => {
    getRecentFiles.mockResolvedValue([
      { id: 'pinyin', name: '研发说明.md', path: '/fixture/研发说明.md', folderPath: '/fixture', lastOpened: 1 },
      { id: 'literal', name: 'yanfa-tools.md', path: '/fixture/yanfa-tools.md', folderPath: '/fixture', lastOpened: 2 },
    ])
    vi.mocked(window.api.getAppSettings).mockResolvedValue({ folderPinyinSearchEnabled: true } as any)
    render(<RecentFilesDropdown onSelectFile={onSelectFile} />)
    await userEvent.click(screen.getByRole('button', { name: '最近打开的文件' }))
    await waitFor(() => expect(screen.getByRole('checkbox', { name: '拼音搜索' })).toBeChecked())
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索最近文件' }), { target: { value: 'yanfa' } })
    const toggle = await screen.findByRole('button', { name: /拼音补充 · 1/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText('yanfa-tools.md')).toBeInTheDocument()
    expect(screen.queryByText('研发说明.md')).toBeNull()
    await userEvent.click(toggle)
    fireEvent.contextMenu(screen.getByText('研发说明.md').closest('.recent-file-item')!)
    expect(showRecentFileContextMenu).toHaveBeenCalledWith('pinyin')
    await userEvent.click(screen.getByRole('button', { name: '从历史中移除 研发说明.md' }))
    expect(removeRecentFile).toHaveBeenCalledWith('/fixture/研发说明.md')
    expect(onSelectFile).not.toHaveBeenCalled()
    expect(screen.queryByText('研发说明.md')).toBeNull()
  })

  it('只匹配文件名，不补充祖先目录拼音，保留完整内部音节而不支持首字母', async () => {
    getRecentFiles.mockResolvedValue([
      { id: 'named', name: '研发中心.md', path: '/fixture/研发中心.md', folderPath: '/fixture', lastOpened: 1 },
      { id: 'ancestor', name: 'README.md', path: '/fixture/研发中心/README.md', folderPath: '/fixture/研发中心', lastOpened: 2 },
    ])
    vi.mocked(window.api.getAppSettings).mockResolvedValue({ folderPinyinSearchEnabled: true } as any)
    render(<RecentFilesDropdown onSelectFile={onSelectFile} />)
    await userEvent.click(screen.getByRole('button', { name: '最近打开的文件' }))
    await waitFor(() => expect(screen.getByRole('checkbox', { name: '拼音搜索' })).toBeChecked())
    const input = screen.getByRole('searchbox', { name: '搜索最近文件' })
    for (const query of ['yan', 'yanf', 'yanfazhongxin', 'zhongxin']) {
      fireEvent.change(input, { target: { value: query } })
      await screen.findByText('研发中心.md')
      expect(screen.queryByText('README.md')).toBeNull()
    }
    for (const query of ['yf', 'ya', 'zhong', 'anfa']) {
      fireEvent.change(input, { target: { value: query } })
      await screen.findByText('未找到匹配文件')
      expect(screen.queryByText('研发中心.md')).toBeNull()
    }
  })

  it('输入法合成与输入框Enter不选择文件，清空和Escape不留下拼音结果', async () => {
    getRecentFiles.mockResolvedValue([
      { id: 'pinyin', name: '研发说明.md', path: '/fixture/研发说明.md', folderPath: '/fixture', lastOpened: 1 },
    ])
    vi.mocked(window.api.getAppSettings).mockResolvedValue({ folderPinyinSearchEnabled: true } as any)
    render(<RecentFilesDropdown onSelectFile={onSelectFile} />)
    const trigger = screen.getByRole('button', { name: '最近打开的文件' })
    await userEvent.click(trigger)
    await waitFor(() => expect(screen.getByRole('checkbox', { name: '拼音搜索' })).toBeChecked())
    const input = screen.getByRole('searchbox', { name: '搜索最近文件' })
    fireEvent.change(input, { target: { value: 'yanfa' } })
    const row = (await screen.findByText('研发说明.md')).closest('.recent-file-item')!
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.keyDown(row, { key: 'Enter', isComposing: true })
    expect(onSelectFile).not.toHaveBeenCalled()
    fireEvent.compositionStart(input)
    expect(screen.queryByText('研发说明.md')).toBeNull()
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
    fireEvent.compositionEnd(input)
    await screen.findByText('研发说明.md')
    fireEvent.change(input, { target: { value: '' } })
    expect(screen.queryByText(/拼音匹配|拼音补充/)).toBeNull()
    input.focus()
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByRole('searchbox', { name: '搜索最近文件' })).toBeNull()
    expect(trigger).toHaveFocus()
    expect(onSelectFile).not.toHaveBeenCalled()
  })

  it('保存开关失败恢复关闭，原文字面筛选仍可使用', async () => {
    render(<RecentFilesDropdown onSelectFile={onSelectFile} />)
    await userEvent.click(screen.getByRole('button', { name: '最近打开的文件' }))
    const checkbox = screen.getByRole('checkbox', { name: '拼音搜索' })
    await waitFor(() => expect(checkbox).toBeEnabled())
    vi.mocked(window.api.updateAppSettings).mockRejectedValueOnce(new Error('fixture save failure'))
    await userEvent.click(checkbox)
    expect(await screen.findByText('设置未保存，请重试')).toBeInTheDocument()
    expect(checkbox).not.toBeChecked()
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索最近文件' }), { target: { value: 'cli' } })
    expect(screen.getByText('cli.md')).toBeInTheDocument()
  })
})
