import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom'
import { RecentFilesDropdown } from '../../src/components/RecentFilesDropdown'

const mockFiles = [
  {
    path: '/Users/mac/Documents/test/testmd/md-viewer/docs/cli.md',
    name: 'cli.md',
    folderPath: '/Users/mac/Documents/test/testmd/md-viewer/docs',
    lastOpened: Date.now() - 5 * 60 * 1000,
  },
  {
    path: '/Users/mac/Documents/SynologyDrive/国开在线/研发中心/专项工作/直播平台/直播说明.md',
    name: '直播说明.md',
    folderPath: '/Users/mac/Documents/SynologyDrive/国开在线/研发中心/专项工作/直播平台',
    lastOpened: Date.now() - 2 * 60 * 60 * 1000,
  },
  {
    path: '/Users/mac/Documents/github/OUCOnline/lms/identity/docs/apisix-cors-config.md',
    name: 'apisix-cors-config.md',
    folderPath: '/Users/mac/Documents/github/OUCOnline/lms/identity/docs',
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
    onSelectFile.mockClear()
    getRecentFiles.mockResolvedValue(mockFiles)
    removeRecentFile.mockResolvedValue(undefined)
    clearRecentFiles.mockResolvedValue(undefined)
    onRecentFileRemove.mockReturnValue(() => undefined)
    showRecentFileContextMenu.mockResolvedValue(undefined)
    readFilePreview.mockResolvedValue('')

    window.api = {
      ...(window.api || {}),
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

    await userEvent.click(screen.getByTitle('最近打开的文件'))

    await waitFor(() => {
      expect(screen.getByText('cli.md')).toBeInTheDocument()
      expect(screen.getByText('直播说明.md')).toBeInTheDocument()
    })

    await userEvent.type(screen.getByPlaceholderText('搜索最近文件...'), 'identity')

    expect(screen.queryByText('cli.md')).not.toBeInTheDocument()
    expect(screen.queryByText('直播说明.md')).not.toBeInTheDocument()
    expect(screen.getByText('apisix-cors-config.md')).toBeInTheDocument()
    expect(screen.getByText('~/Documents/github/OUCOnline/lms/identity/docs')).toBeInTheDocument()
  })

  it('没有匹配结果时显示空状态，并支持清空历史', async () => {
    render(<RecentFilesDropdown onSelectFile={onSelectFile} />)

    await userEvent.click(screen.getByTitle('最近打开的文件'))
    await waitFor(() => expect(screen.getByText('cli.md')).toBeInTheDocument())

    await userEvent.type(screen.getByPlaceholderText('搜索最近文件...'), 'not-found')
    expect(screen.getByText('未找到匹配文件')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '清空最近文件' }))

    expect(clearRecentFiles).toHaveBeenCalledTimes(1)
    expect(screen.getByText('暂无最近打开的文件')).toBeInTheDocument()
  })
})
