import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { WorkspaceImportControl } from '../../src/components/WorkspaceImportControl'

const source = {
  windowId: 2,
  title: '视频',
  workspaceCount: 5,
  summary: '5 个会话 · 7 个标签 · 含分屏',
  workspaces: [],
}

describe('WorkspaceImportControl', () => {
  afterEach(() => vi.restoreAllMocks())

  it('没有候选时不显示独立入口', () => {
    const { container } = render(
      <WorkspaceImportControl onBegin={vi.fn()} isTransferring={false} sourcesAvailable={false} />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('空窗口显示关闭语义而不是伪造会话迁移', async () => {
    const emptySource = { ...source, title: 'youxiang', workspaceCount: 0, summary: '无打开会话' }
    global.window.api = { ...global.window.api, listWorkspaceMergeSources: vi.fn().mockResolvedValue([emptySource]) } as typeof window.api
    const onBegin = vi.fn().mockResolvedValue(undefined)
    render(<WorkspaceImportControl onBegin={onBegin} isTransferring={false} />)
    fireEvent.click(screen.getByRole('button', { name: '合并其他窗口' }))
    fireEvent.click(await screen.findByRole('radio'))
    expect(screen.getByText(/没有需要迁移的阅读会话/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '关闭此窗口' })).toBeEnabled()
  })

  it('每个来源窗口只显示一个选项并整体合并', async () => {
    global.window.api = { ...global.window.api, listWorkspaceMergeSources: vi.fn().mockResolvedValue([source]) } as typeof window.api
    const onBegin = vi.fn().mockResolvedValue(undefined)
    render(<WorkspaceImportControl onBegin={onBegin} isTransferring={false} />)
    fireEvent.click(screen.getByRole('button', { name: '合并其他窗口' }))

    expect(await screen.findByText('视频')).toBeInTheDocument()
    expect(screen.getByText('5 个会话 · 7 个标签 · 含分屏')).toBeInTheDocument()
    expect(screen.getAllByRole('radio')).toHaveLength(1)
    expect(screen.getByRole('button', { name: '合并此窗口' })).toBeDisabled()

    fireEvent.click(screen.getByRole('radio'))
    expect(screen.getByText(/5 个会话将移入当前窗口/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '合并此窗口' }))
    await waitFor(() => expect(onBegin).toHaveBeenCalledWith(2))
  })

  it('没有来源时显示可达的空状态', async () => {
    global.window.api = { ...global.window.api, listWorkspaceMergeSources: vi.fn().mockResolvedValue([]) } as typeof window.api
    render(<WorkspaceImportControl onBegin={vi.fn()} isTransferring={false} />)
    fireEvent.click(screen.getByRole('button', { name: '合并其他窗口' }))
    expect(await screen.findByText('没有其他打开的窗口可合并。')).toBeInTheDocument()
  })

  it('由父组件受控打开并在 Escape 后通知关闭', async () => {
    const onOpenChange = vi.fn()
    global.window.api = { ...global.window.api, listWorkspaceMergeSources: vi.fn().mockResolvedValue([]) } as typeof window.api
    render(<WorkspaceImportControl open onOpenChange={onOpenChange} hideTrigger onBegin={vi.fn()} isTransferring={false} />)
    expect(await screen.findByRole('dialog', { name: '合并其他窗口' })).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
