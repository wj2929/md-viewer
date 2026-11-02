import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { LargeDocumentPreview } from '../../src/components/LargeDocumentPreview'
import type { LargeDocumentSize } from '../../../shared/largeDocumentApproval'

vi.mock('../../src/utils/workspaceOperationContext', () => ({
  getActiveWorkspaceOperationContext: () => ({ workspaceId: 'self-workspace', lifecycleEpoch: 1 })
}))
const large = `# Large\n${'\n'.repeat(20_000)}<script>window.alert('unsafe')</script>\nEND`
let approvals: Map<string, LargeDocumentSize>
const getApproval = vi.fn(async (path: string): Promise<LargeDocumentSize | null> => approvals.get(path) ?? null)
const setApproval = vi.fn(async (path: string, value: LargeDocumentSize | null) => {
  if (value) approvals.set(path, value)
  else approvals.delete(path)
})
function preview(content = large, filePath = '/docs/a.md') {
  return <LargeDocumentPreview content={content} filePath={filePath}><p>Rendered body</p></LargeDocumentPreview>
}
const ready = () => waitFor(() => expect(screen.queryByText('正在读取大文档预览选择…')).not.toBeInTheDocument())
function approve(remember = false) {
  if (remember) fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(screen.getByRole('button', { name: '完整渲染' }))
}

beforeEach(() => {
  vi.restoreAllMocks()
  approvals = new Map()
  getApproval.mockReset().mockImplementation(async path => approvals.get(path) ?? null)
  setApproval.mockReset().mockImplementation(async (path, value) => {
    if (value) approvals.set(path, value)
    else approvals.delete(path)
  })
  window.api = { ...window.api, getLargeDocumentApproval: getApproval, setLargeDocumentApproval: setApproval }
})

describe('LargeDocumentPreview', () => {
  it('普通文档与恰好达到两个预算的文档无需确认或读取批准', () => {
    const content = `${'x'.repeat(1_500_000 - 19_999)}${'\n'.repeat(19_999)}`
    render(preview(content))
    expect(screen.getByText('Rendered body')).toBeInTheDocument()
    expect(screen.queryByRole('region')).not.toBeInTheDocument()
    expect(getApproval).not.toHaveBeenCalled()
  })

  it('选择前不挂载渲染器，查看源码只显示原始文本', async () => {
    const mounted = vi.fn(() => <p>Unexpected render</p>)
    const Body = mounted
    render(<LargeDocumentPreview content={large}><Body /></LargeDocumentPreview>)
    expect(mounted).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '查看源码' }))
    expect(screen.getByRole('textbox')).toHaveValue(large)
    expect(screen.getByRole('textbox')).toHaveAttribute('readonly')
    expect(document.querySelector('script')).toBeNull()
    expect(mounted).not.toHaveBeenCalled()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '收起源码' }))
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('临时放行不持久化，重新挂载需要再次确认', async () => {
    const view = render(preview()); await ready()
    approve()
    expect(screen.getByText('Rendered body')).toBeInTheDocument()
    expect(setApproval).not.toHaveBeenCalled()
    view.unmount()
    render(preview()); await ready()
    expect(screen.queryByText('Rendered body')).not.toBeInTheDocument()
  })

  it('记住选择可跨挂载恢复，并支持撤销', async () => {
    const view = render(preview()); await ready()
    approve(true)
    await waitFor(() => expect(setApproval).toHaveBeenCalledTimes(1))
    view.unmount()
    render(preview()); await ready()
    expect(screen.getByText('Rendered body')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '恢复大文档提示' }))
    expect(screen.queryByText('Rendered body')).not.toBeInTheDocument()
    await waitFor(() => expect(setApproval).toHaveBeenLastCalledWith('/docs/a.md', null, { workspaceId: 'self-workspace', lifecycleEpoch: 1 }))
    expect(approvals.size).toBe(0)
  })

  it('不会把文档 A 的放行沿用到文档 B', async () => {
    const view = render(preview()); await ready()
    approve(true)
    view.rerender(preview(large, '/docs/b.md')); await ready()
    expect(screen.queryByText('Rendered body')).not.toBeInTheDocument()
  })

  it('行数明显增长后重新提示，小幅增长不累计扩大授权', async () => {
    const view = render(preview('\n'.repeat(20_000))); await ready()
    approve(true)
    view.rerender(preview('\n'.repeat(24_000)))
    expect(screen.getByText('Rendered body')).toBeInTheDocument()
    view.rerender(preview('\n'.repeat(25_001)))
    expect(screen.queryByText('Rendered body')).not.toBeInTheDocument()
  })

  it('字符数明显增长后重新提示', async () => {
    const view = render(preview('x'.repeat(1_600_000))); await ready()
    approve(true)
    view.rerender(preview('x'.repeat(2_000_000)))
    expect(screen.getByText('Rendered body')).toBeInTheDocument()
    view.rerender(preview('x'.repeat(2_000_001)))
    expect(screen.queryByText('Rendered body')).not.toBeInTheDocument()
  })

  it('恢复记忆也会校验增长，新增超预算维度需确认', async () => {
    const view = render(preview()); await ready()
    approve(true)
    await waitFor(() => expect(setApproval).toHaveBeenCalledTimes(1))
    view.unmount()
    render(preview('x'.repeat(1_500_001))); await ready()
    expect(screen.queryByText('Rendered body')).not.toBeInTheDocument()
  })

  it('存储不可读或不可写时仍可临时完整渲染', async () => {
    getApproval.mockRejectedValueOnce(new Error('Unavailable'))
    setApproval.mockRejectedValueOnce(new Error('Unavailable'))
    render(preview()); await ready()
    approve(true)
    expect(screen.getByText('Rendered body')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('无法保存本地选择'))
  })

  it('无效批准不能放行，保存只包含规模而不含正文', async () => {
    getApproval.mockResolvedValueOnce({ characters: 'huge', lines: -1 } as unknown as LargeDocumentSize)
    render(preview()); await ready()
    expect(screen.queryByText('Rendered body')).not.toBeInTheDocument()
    approve(true)
    await waitFor(() => expect(setApproval).toHaveBeenCalledWith('/docs/a.md', { characters: large.length, lines: large.split('\n').length }, { workspaceId: 'self-workspace', lifecycleEpoch: 1 }))
    expect(JSON.stringify(setApproval.mock.calls)).not.toContain('<script>')
  })

  it('读取批准完成前不渲染或显示可点击选择', async () => {
    let resolve!: (value: LargeDocumentSize | null) => void
    getApproval.mockReturnValueOnce(new Promise(done => { resolve = done }))
    render(preview())
    expect(screen.getByRole('status')).toHaveTextContent('正在读取')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByText('Rendered body')).not.toBeInTheDocument()
    await act(async () => resolve({ characters: large.length, lines: 20_003 }))
    expect(screen.getByText('Rendered body')).toBeInTheDocument()
  })

  it('旧文档的迟到读取不能放行当前文档', async () => {
    let resolve!: (value: LargeDocumentSize | null) => void
    getApproval.mockReturnValueOnce(new Promise(done => { resolve = done }))
    const view = render(preview())
    view.rerender(preview(large, '/docs/b.md')); await ready()
    await act(async () => resolve({ characters: large.length, lines: 20_003 }))
    expect(screen.queryByText('Rendered body')).not.toBeInTheDocument()
  })

  it('记住后立即撤销按顺序落盘，不被旧请求覆盖', async () => {
    let finish!: () => void
    setApproval.mockImplementationOnce(async (path, value) => {
      await new Promise<void>(resolve => { finish = resolve })
      approvals.set(path, value!)
    })
    render(preview()); await ready()
    approve(true)
    await waitFor(() => expect(setApproval).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: '恢复大文档提示' }))
    expect(setApproval).toHaveBeenCalledTimes(1)
    await act(async () => finish())
    await waitFor(() => expect(setApproval).toHaveBeenCalledTimes(2))
    expect(approvals.size).toBe(0)
  })
})
