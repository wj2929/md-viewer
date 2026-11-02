import { beforeEach, describe, expect, it, vi } from 'vitest'
import { StrictMode } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { LargeDocumentPreview } from '../../src/components/LargeDocumentPreview'
import { recordPreviewState } from '../../src/utils/diagnostics'

vi.mock('../../src/utils/diagnostics', () => ({ recordPreviewState: vi.fn() }))
vi.mock('../../src/utils/workspaceOperationContext', () => ({ getActiveWorkspaceOperationContext: () => ({ workspaceId: 'self', lifecycleEpoch: 1 }) }))
const content = 'x'.repeat(1_500_001)
const operation = { context: { operationId: 'file_self_12345678', source: 'restore' as const }, startedMonotonicMs: 0, startedUnixMs: 0 }
const states = () => vi.mocked(recordPreviewState).mock.calls.map(call => call[1])
function preview(id = 'preview_self_12345678', path = '/private/a.md') {
  return <LargeDocumentPreview content={content} filePath={path} diagnosticPreviewId={id} diagnosticOperation={operation}>
    <p>Rendered body</p>
  </LargeDocumentPreview>
}
const settled = () => waitFor(() => expect(states().at(-1)).toBe('awaiting-choice'))
beforeEach(() => {
  vi.mocked(recordPreviewState).mockReset()
  window.api = { ...window.api, getLargeDocumentApproval: vi.fn(async () => null), setLargeDocumentApproval: vi.fn(async () => {}) }
})

describe('large document diagnostic states', () => {
  it('等待、源码、收起、请求渲染与撤销只记录真实状态，不伪造完成', async () => {
    render(preview())
    await settled()
    expect(states()).toEqual(['loading-approval', 'awaiting-choice'])
    vi.mocked(recordPreviewState).mockImplementation((_, state) => {
      if (state === 'source-ready') expect(screen.getByRole('textbox')).toHaveValue(content)
    })
    fireEvent.click(screen.getByRole('button', { name: '查看源码' }))
    fireEvent.click(screen.getByRole('button', { name: '收起源码' }))
    fireEvent.click(screen.getByRole('button', { name: '完整渲染' }))
    expect(screen.getByText('Rendered body')).toBeInTheDocument()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '恢复大文档提示' })) })
    expect(states()).toEqual(['loading-approval', 'awaiting-choice', 'source-ready', 'awaiting-choice', 'render-requested', 'awaiting-choice'])
    expect(JSON.stringify(vi.mocked(recordPreviewState).mock.calls)).not.toContain('/private/')
  })

  it('相同 props 重渲染、勾选记住均不刷状态日志', async () => {
    const view = render(preview())
    await settled()
    view.rerender(preview())
    fireEvent.click(screen.getByRole('checkbox'))
    expect(states()).toEqual(['loading-approval', 'awaiting-choice'])
  })

  it('切文档先结束旧实例，新实例不沿用旧文档的临时放行', async () => {
    const view = render(preview())
    await settled()
    fireEvent.click(screen.getByRole('button', { name: '完整渲染' }))
    view.rerender(preview('preview_other_12345678', '/private/b.md'))
    await settled()
    expect(states()).toEqual(['loading-approval', 'awaiting-choice', 'render-requested', 'unmounted', 'loading-approval', 'awaiting-choice'])
    expect(vi.mocked(recordPreviewState).mock.calls.findLast(call => call[1] === 'unmounted')?.[0]).toBe('preview_self_12345678')
    expect(vi.mocked(recordPreviewState).mock.calls.at(-1)?.[0]).toBe('preview_other_12345678')
    expect(screen.queryByText('Rendered body')).not.toBeInTheDocument()
  })

  it('同文档刷新仅换观测实例，不撤销用户已做的渲染选择', async () => {
    const view = render(preview())
    await settled()
    fireEvent.click(screen.getByRole('button', { name: '完整渲染' }))
    view.rerender(preview('preview_other_12345678'))
    expect(states().slice(-2)).toEqual(['unmounted', 'render-requested'])
    expect(screen.getByText('Rendered body')).toBeInTheDocument()
  })

  it('源码模式卸载记录结束；StrictMode 效果重放后最新状态仍正确', async () => {
    const view = render(<StrictMode>{preview()}</StrictMode>)
    await settled()
    expect(states().at(-1)).toBe('awaiting-choice')
    fireEvent.click(screen.getByRole('button', { name: '查看源码' }))
    view.unmount()
    expect(states().slice(-2)).toEqual(['source-ready', 'unmounted'])
  })
})
