import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceWatchHealth, WorkspaceWatchStatusEvent } from '../../../shared/workspaceWatch'
import { WatchStatus } from '../../src/components/WatchStatus'

const health = (changes: Partial<WorkspaceWatchHealth> = {}): WorkspaceWatchHealth => ({
  version: 1, state: 'healthy', partialCoverage: false, excludedDirectoryCount: 0,
  gapVersion: 1, reconciledGapVersion: 1, ...changes,
})
let listener: (event: WorkspaceWatchStatusEvent) => void
let api: { getWatchStatus: ReturnType<typeof vi.fn>; onWatchStatus: ReturnType<typeof vi.fn>; retryWatch: ReturnType<typeof vi.fn> }
const props = { workspaceId: 'one', lifecycleEpoch: 4, onRefresh: vi.fn() }
const trigger = () => screen.getByRole('button', { name: '刷新文件列表' })
const emit = (status: WorkspaceWatchHealth, workspaceId = 'one', lifecycleEpoch = 4) => {
  act(() => listener({ workspaceId, lifecycleEpoch, status }))
}

beforeEach(() => {
  props.onRefresh = vi.fn().mockResolvedValue(undefined)
  api = {
    getWatchStatus: vi.fn().mockResolvedValue(health()),
    onWatchStatus: vi.fn(callback => { listener = callback; return vi.fn() }),
    retryWatch: vi.fn().mockResolvedValue({ accepted: true }),
  }
  ;(window as any).api = api
})
afterEach(() => vi.useRealTimers())

describe('WatchStatus refresh control', () => {
  it('健康状态保留原刷新操作，不出现横幅或弹层', async () => {
    const { container } = render(<WatchStatus {...props} />)
    fireEvent.click(trigger())
    await waitFor(() => expect(props.onRefresh).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger()).not.toHaveAttribute('aria-haspopup')
    expect(container.querySelector('.watch-status')).toBeNull()
    expect(container.querySelector('.watch-refresh-mark')).toBeNull()
  })

  it('受限状态只显示低调标记，点击才展开说明和手动刷新', async () => {
    const { container } = render(<WatchStatus {...props} />)
    emit(health({ version: 2, partialCoverage: true, excludedDirectoryCount: 2 }))
    expect(container.querySelector('.watch-refresh-mark:not(.is-degraded)')).not.toBeNull()
    expect(trigger()).toHaveAttribute('data-tooltip', '自动刷新正常，已忽略构建目录，点击查看')
    expect(screen.queryByText(/生成目录内未打开文件/)).not.toBeInTheDocument()
    expect(trigger()).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(trigger())
    expect(screen.getByRole('dialog', { name: '自动刷新状态' })).toHaveTextContent('生成目录内未打开文件不自动刷新')
    expect(screen.getByRole('dialog')).toHaveTextContent('已忽略 2 个 bin/obj 构建目录')
    expect(screen.getByRole('dialog')).toHaveTextContent('已打开文件仍会监听')
    expect(screen.getByRole('button', { name: '刷新内容' })).toHaveFocus()
    expect(screen.queryByRole('button', { name: '重试自动刷新' })).not.toBeInTheDocument()
    expect(props.onRefresh).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '刷新内容' }))
    await waitFor(() => expect(props.onRefresh).toHaveBeenCalledTimes(1))
  })

  it('恢复中只转动图标，恢复健康后关闭弹层并返还焦点', () => {
    const { container } = render(<WatchStatus {...props} />)
    emit(health({ version: 2, state: 'recovering' }))
    expect(container.querySelector('.watch-refresh-icon.is-spinning')).not.toBeNull()
    expect(trigger()).toHaveAttribute('data-tooltip', '正在同步变更，点击查看')
    fireEvent.click(trigger())
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    emit(health({ version: 3 }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger()).toHaveFocus()
    expect(container.querySelector('.is-spinning')).toBeNull()
  })

  it('降级显示黄色标记，重试只发送当前工作区上下文且在途防重复', async () => {
    let finish!: () => void
    api.retryWatch.mockReturnValue(new Promise<void>(resolve => { finish = resolve }))
    const { container } = render(<WatchStatus {...props} />)
    emit(health({ version: 2, state: 'degraded', reason: 'resource' }))
    expect(container.querySelector('.watch-refresh-mark.is-degraded')).toHaveTextContent('!')
    fireEvent.click(trigger())
    const retry = screen.getByRole('button', { name: '重试自动刷新' })
    fireEvent.click(retry)
    fireEvent.click(retry)
    expect(api.retryWatch).toHaveBeenCalledExactlyOnceWith('one', 4)
    expect(retry).toBeDisabled()
    expect(screen.getByRole('button', { name: '刷新内容' })).toBeDisabled()
    await act(async () => finish())
    expect(retry).toBeEnabled()
  })

  it('Escape 关闭并恢复焦点；点击外部关闭', () => {
    render(<WatchStatus {...props} />)
    emit(health({ version: 2, partialCoverage: true }))
    fireEvent.click(trigger())
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger()).toHaveFocus()
    fireEvent.click(trigger())
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('旧快照、其他工作区和旧 epoch 不覆盖较新的健康事件', async () => {
    let resolve!: (status: WorkspaceWatchHealth) => void
    api.getWatchStatus.mockReturnValue(new Promise<WorkspaceWatchHealth>(r => { resolve = r }))
    render(<WatchStatus {...props} />)
    emit(health({ version: 5, state: 'degraded', reason: 'resource' }))
    await act(async () => resolve(health({ version: 1 })))
    emit(health({ version: 6 }), 'other')
    emit(health({ version: 6 }), 'one', 3)
    expect(trigger()).toHaveAttribute('data-tooltip', '自动刷新暂不可用，点击查看')
    emit(health({ version: 6 }))
    expect(trigger()).toHaveAttribute('data-tooltip', '刷新文件列表')
  })

  it('切换生命周期重新挂载后，旧操作失败不污染新工作区', async () => {
    let reject!: (error: Error) => void
    api.retryWatch.mockReturnValue(new Promise((_, r) => { reject = r }))
    const { rerender } = render(<WatchStatus key="one:4" {...props} />)
    emit(health({ version: 2, state: 'degraded', reason: 'resource' }))
    fireEvent.click(trigger())
    fireEvent.click(screen.getByRole('button', { name: '重试自动刷新' }))
    const unsubscribe = api.onWatchStatus.mock.results[0].value
    rerender(<WatchStatus key="two:1" {...props} workspaceId="two" lifecycleEpoch={1} />)
    await act(async () => reject(new Error('old request')))
    expect(unsubscribe).toHaveBeenCalled()
    expect(trigger()).toBeEnabled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('正常刷新失败也能看到错误及重试入口', async () => {
    props.onRefresh.mockRejectedValueOnce(new Error('refresh failed'))
    render(<WatchStatus {...props} />)
    fireEvent.click(trigger())
    expect(await screen.findByRole('alert')).toHaveTextContent('操作未完成')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    props.onRefresh.mockResolvedValue(undefined)
    fireEvent.click(screen.getByRole('button', { name: '刷新内容' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('初始启动保留短暂宽限，不立刻显示状态标记', async () => {
    vi.useFakeTimers()
    api.getWatchStatus.mockResolvedValue(health({ state: 'starting' }))
    const { container } = render(<WatchStatus {...props} />)
    await act(async () => { await Promise.resolve() })
    expect(container.querySelector('.is-spinning')).toBeNull()
    act(() => vi.advanceTimersByTime(1000))
    expect(container.querySelector('.is-spinning')).not.toBeNull()
  })
})
