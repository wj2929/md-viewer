import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SearchBar } from '../../src/components/SearchBar'
import { useWorkspaceStore } from '../../src/stores/workspaceStore'

const reclaim = vi.fn()
const workspace = { id: 'workspace-a', primaryRoot: '/test', lifecycleEpoch: 4, name: 'test' }
beforeEach(() => {
  reclaim.mockReset().mockResolvedValue({ status: 'cancelled', message: '已取消，未清理旧索引。' })
  window.api = {
    platform: 'darwin', reclaimWorkspaceIndex: reclaim,
    getRecentFiles: vi.fn().mockResolvedValue([]), getFolderHistory: vi.fn().mockResolvedValue([]),
    readFile: vi.fn(), searchReadDir: vi.fn().mockResolvedValue([]),
    queryWorkspaceIndex: vi.fn().mockResolvedValue([]),
    getWorkspaceIndexStatus: vi.fn().mockResolvedValue({ state: 'ready', indexedDocuments: 0, totalDocuments: 0, pendingDocuments: 0, errors: 0, generation: 1 }),
  } as any
  useWorkspaceStore.setState({ workspaces: [workspace], activeWorkspaceId: workspace.id, runtimes: {} })
})
async function open() {
  const view = render(<SearchBar files={[]} folderPath="/test" onFileSelect={vi.fn()} onExternalFileOpen={vi.fn()} />)
  await userEvent.click(screen.getByRole('button', { name: /搜索文件/ }))
  await userEvent.click(screen.getByRole('button', { name: '全文' }))
  await userEvent.click(screen.getByRole('button', { name: '搜索全部数据源' }))
  return view
}

describe('current workspace reclamation control', () => {
  it('is available for a healthy workspace without a query and never starts on render', async () => {
    await open()
    expect(screen.getByRole('button', { name: '清理当前工作区旧索引…' })).toBeEnabled()
    expect(reclaim).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: '清理当前工作区旧索引…' }))
    expect(reclaim).toHaveBeenCalledWith({ workspaceId: workspace.id, primaryRoot: '/test', lifecycleEpoch: 4 })
    expect(await screen.findByText('已取消，未清理旧索引。')).toBeInTheDocument()
  })

  it('hides the action for all-workspace and filename search', async () => {
    await open()
    await userEvent.click(screen.getByRole('button', { name: '仅搜索当前文件夹' }))
    expect(screen.queryByRole('button', { name: '清理当前工作区旧索引…' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '搜索全部数据源' }))
    await userEvent.click(screen.getByRole('button', { name: '文件名' }))
    expect(screen.queryByRole('button', { name: '清理当前工作区旧索引…' })).not.toBeInTheDocument()
  })

  it('prevents duplicate requests and suppresses late results after a workspace epoch change', async () => {
    let finish!: (result: { status: string; message: string }) => void
    reclaim.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    await open()
    const button = screen.getByRole('button', { name: '清理当前工作区旧索引…' })
    fireEvent.click(button)
    fireEvent.click(button)
    expect(reclaim).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: '正在核对旧索引…' })).toBeDisabled()
    await act(async () => {
      useWorkspaceStore.setState({ workspaces: [{ ...workspace, lifecycleEpoch: 5 }] })
      finish({ status: 'completed', message: '旧工作区清理结果' })
    })
    await waitFor(() => expect(screen.getByRole('button', { name: '清理当前工作区旧索引…' })).toBeEnabled())
    expect(screen.queryByText('旧工作区清理结果')).not.toBeInTheDocument()
  })
})
