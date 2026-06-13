import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom'
import { FolderHistoryDropdown } from '../../src/components/FolderHistoryDropdown'

const mockFolders = [
  {
    path: '/Users/mac/Documents/test/testmd/md-viewer/e2e/fixtures',
    name: 'fixtures',
    lastOpened: Date.now() - 5 * 60 * 1000,
  },
  {
    path: '/Users/mac/Documents/SynologyDrive/国开在线/研发中心/专项工作/直播平台',
    name: '直播平台',
    lastOpened: Date.now() - 2 * 60 * 60 * 1000,
  },
  {
    path: '/Users/mac/Documents/github/OUCOnline/lms/identity/docs',
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

  beforeEach(() => {
    onSelectFolder.mockClear()
    onOpenFolder.mockClear()
    getFolderHistory.mockResolvedValue(mockFolders)
    removeFolderFromHistory.mockResolvedValue(undefined)
    clearFolderHistory.mockResolvedValue(undefined)

    window.api = {
      ...(window.api || {}),
      getFolderHistory,
      removeFolderFromHistory,
      clearFolderHistory,
      platform: 'darwin',
    } as any
  })

  it('按名称或路径搜索最近文件夹并显示匹配结果', async () => {
    render(<FolderHistoryDropdown onSelectFolder={onSelectFolder} onOpenFolder={onOpenFolder} />)

    await userEvent.click(screen.getByLabelText('最近打开的文件夹'))

    await waitFor(() => {
      expect(screen.getByText('fixtures')).toBeInTheDocument()
      expect(screen.getByText('直播平台')).toBeInTheDocument()
    })

    const searchInput = screen.getByPlaceholderText('搜索最近文件夹...')
    await userEvent.type(searchInput, 'identity')

    expect(screen.queryByText('fixtures')).not.toBeInTheDocument()
    expect(screen.queryByText('直播平台')).not.toBeInTheDocument()
    expect(screen.getByText('docs')).toBeInTheDocument()
    expect(screen.getByText('~/Documents/github/OUCOnline/lms/identity/docs')).toBeInTheDocument()
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
})
