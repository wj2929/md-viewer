import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FileTreeMoveRepairDialog } from '../../src/components/FileTreeMoveRepairDialog'
import { MoveToDialog } from '../../src/components/MoveToDialog'
import { useWorkspaceStore } from '../../src/stores/workspaceStore'
import { useFolderSearchSettingsStore } from '../../src/stores/folderSearchSettingsStore'

const operation = { workspaceId: 'workspace-a', lifecycleEpoch: 1 }
const mappings = ['a', 'b'].map(name => ({ oldRelativePath: `${name}.md`, newRelativePath: `archive/${name}.md` }))
const impacts = mappings.map((mapping, index) => ({ impactId: `impact-${index}`, mapping, affectedSourceFiles: 1, exactChanges: 1, candidates: 0, items: [] }))
const makePlan = (receiptId: string) => ({
  planId: `plan-${receiptId}`, operationReceiptId: receiptId, warnings: [],
  changes: [{ changeId: `change-${receiptId}`, sourceRelativePath: 'index.md', lineStart: 1, before: './a.md', after: './archive/a.md' }],
})
const api = () => window.api as any

beforeEach(() => {
  useFolderSearchSettingsStore.setState({ hydration: 'idle', enabled: false, pending: null, saving: false, hasLoaded: false, error: null, revision: 0 })
  useWorkspaceStore.setState({ workspaces: [{ id: 'workspace-a', name: 'Workspace', primaryRoot: '/src', lifecycleEpoch: 1 }] as any, activeWorkspaceId: 'workspace-a', runtimes: {} })
  window.api = {
    getAppSettings: vi.fn().mockResolvedValue({}), updateAppSettings: vi.fn(),
    getFolderHistory: vi.fn().mockResolvedValue([{ id: 'same', path: '/src', name: 'src', lastOpened: 1 }]),
    listChildDirs: vi.fn().mockResolvedValue([{ name: 'archive', path: '/src/archive' }]),
    createLinkImpact: vi.fn(async (_operation, mapping) => impacts.find(item => item.mapping.oldRelativePath === mapping.oldRelativePath)),
    executeLinkRewriteBatch: vi.fn().mockResolvedValue({ items: mappings.map((mapping, index) => ({
      impactId: `impact-${index}`, mapping, status: 'success', receipt: { operationReceiptId: `receipt-${index}` },
    })) }),
    executeLinkRewriteOperation: vi.fn(), moveFileToFolder: vi.fn(),
    createLinkRepairPlan: vi.fn(), applyLinkRepairPlans: vi.fn().mockResolvedValue({ files: [] }),
    discardLinkRepairPlan: vi.fn().mockResolvedValue(undefined),
  } as any
})

async function openAndMove(entry: 'drag' | 'move-to') {
  const onClose = vi.fn()
  const view = entry === 'drag'
    ? render(<FileTreeMoveRepairDialog operation={operation} sources={['/src/a.md', '/src/b.md']} targetDir="/src/archive" mappings={mappings} impacts={impacts as any} onClose={onClose} />)
    : render(<MoveToDialog isOpen sources={['/src/a.md', '/src/b.md']} onClose={onClose} />)
  if (entry === 'move-to') {
    fireEvent.click(await screen.findByText('src'))
    fireEvent.click(await screen.findByText('archive'))
  }
  await waitFor(() => expect(screen.getByRole('button', { name: '移动 2 项' })).not.toBeDisabled())
  fireEvent.click(screen.getByRole('button', { name: '移动 2 项' }))
  await screen.findByText('2 项成功 · 0 项失败')
  return { ...view, onClose }
}

for (const entry of ['drag', 'move-to'] as const) describe(`${entry} repair preview recovery`, () => {
  it('全部预览失效时展示原因，仅用户点击后重新生成，不重复移动或自动写链接', async () => {
    api().createLinkRepairPlan.mockRejectedValueOnce(new Error("Error invoking remote method 'link-rewrite:createRepairPlan': Error: 链接索引已变化，请重新预览文件操作"))
      .mockRejectedValueOnce(new Error('链接索引已变化，请重新预览文件操作'))
      .mockImplementation(async (_operation: unknown, _mapping: unknown, _reason: unknown, receiptId: string) => makePlan(receiptId))
    await openAndMove(entry)
    expect(await screen.findAllByText(/链接索引已变化，请重新预览文件操作/)).not.toHaveLength(0)
    expect(screen.queryByText(/Error invoking remote method/)).toBeNull()
    expect(api().createLinkRepairPlan).toHaveBeenCalledTimes(2)
    expect(api().applyLinkRepairPlans).not.toHaveBeenCalled()
    const retry = screen.getByRole('button', { name: '重新生成链接修复预览' })
    fireEvent.click(retry)
    await waitFor(() => expect(api().createLinkRepairPlan).toHaveBeenCalledTimes(4))
    expect(await screen.findByRole('button', { name: '查看可更新的链接' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '重新生成链接修复预览' })).toBeNull()
    expect(screen.queryByText(/链接索引已变化/)).toBeNull()
    expect(api().executeLinkRewriteBatch).toHaveBeenCalledTimes(1)
    expect(api().executeLinkRewriteOperation).not.toHaveBeenCalled()
    expect(api().moveFileToFolder).not.toHaveBeenCalled()
    expect(api().applyLinkRepairPlans).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '查看可更新的链接' }))
    fireEvent.click(screen.getByRole('button', { name: '更新 1 个文件中的 2 处链接' }))
    await waitFor(() => expect(api().applyLinkRepairPlans).toHaveBeenCalledWith(operation, {
      plans: [0, 1].map(index => ({ planId: `plan-receipt-${index}`, operationReceiptId: `receipt-${index}`, selectedChangeIds: [`change-receipt-${index}`] })), confirm: true,
    }))
  })

  it('部分成功时仅重建失败项，连续点击不并发消费回执，保留已有预览', async () => {
    let complete!: (value: ReturnType<typeof makePlan>) => void
    api().createLinkRepairPlan.mockResolvedValueOnce(makePlan('receipt-0'))
      .mockRejectedValueOnce(new Error('链接索引已变化，请重新预览文件操作'))
      .mockImplementationOnce(() => new Promise(resolve => { complete = resolve }))
    await openAndMove(entry)
    const retry = await screen.findByRole('button', { name: '重新生成链接修复预览' })
    expect(api().createLinkRepairPlan).toHaveBeenCalledTimes(2)
    fireEvent.click(retry)
    fireEvent.click(retry)
    await waitFor(() => expect(api().createLinkRepairPlan).toHaveBeenCalledTimes(3))
    expect(api().createLinkRepairPlan).toHaveBeenLastCalledWith(operation, mappings[1], 'move', 'receipt-1')
    expect(screen.getByRole('button', { name: '正在生成链接修复预览…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '查看可更新的链接' })).toBeDisabled()
    await act(async () => complete(makePlan('receipt-1')))
    expect(await screen.findByText('可更新 2 处链接')).toBeTruthy()
    expect(api().createLinkRepairPlan.mock.calls.filter((call: unknown[]) => call[3] === 'receipt-0')).toHaveLength(1)
    expect(api().executeLinkRewriteBatch).toHaveBeenCalledTimes(1)
    expect(api().applyLinkRepairPlans).not.toHaveBeenCalled()
  })

  it('在差异页恢复失败项时保留用户取消的已有选择', async () => {
    api().createLinkRepairPlan.mockResolvedValueOnce(makePlan('receipt-0'))
      .mockRejectedValueOnce(new Error('链接索引已变化'))
      .mockResolvedValueOnce(makePlan('receipt-1'))
    await openAndMove(entry)
    fireEvent.click(await screen.findByRole('button', { name: '查看可更新的链接' }))
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: '重新生成链接修复预览' }))
    await waitFor(() => expect(screen.getAllByRole('checkbox')).toHaveLength(2))
    expect(screen.getAllByRole('checkbox')[0]).not.toBeChecked()
    expect(screen.getAllByRole('checkbox')[1]).toBeChecked()
    expect(screen.getByRole('button', { name: '更新 1 个文件中的 1 处链接' })).toBeTruthy()
    expect(api().createLinkRepairPlan).toHaveBeenCalledTimes(3)
    expect(api().applyLinkRepairPlans).not.toHaveBeenCalled()
  })

  it('工作区切换和回执过期不能换用新上下文或重新移动，仍显示真实失败原因', async () => {
    api().createLinkRepairPlan.mockRejectedValueOnce(new Error('链接索引已变化'))
      .mockRejectedValueOnce(new Error('链接索引已变化'))
      .mockRejectedValue(new Error('文件操作回执无效或已过期'))
    await openAndMove(entry)
    const retry = await screen.findByRole('button', { name: '重新生成链接修复预览' })
    act(() => useWorkspaceStore.setState({ activeWorkspaceId: 'other', workspaces: [{ id: 'other', primaryRoot: '/other', lifecycleEpoch: 9 }] as any }))
    fireEvent.click(retry)
    expect(await screen.findAllByText(/文件操作回执无效或已过期/)).not.toHaveLength(0)
    expect(api().createLinkRepairPlan).toHaveBeenCalledTimes(4)
    expect(api().createLinkRepairPlan.mock.calls.every((call: unknown[]) => JSON.stringify(call[0]) === JSON.stringify(operation))).toBe(true)
    expect(api().executeLinkRewriteBatch).toHaveBeenCalledTimes(1)
    expect(api().applyLinkRepairPlans).not.toHaveBeenCalled()
    expect(screen.getByText('2 项成功 · 0 项失败')).toBeTruthy()
  })
})

it('移动目标弹窗关闭再打开后不接收旧恢复请求的迟到结果', async () => {
  const completions: Array<(value: ReturnType<typeof makePlan>) => void> = []
  api().createLinkRepairPlan.mockRejectedValueOnce(new Error('链接索引已变化'))
    .mockRejectedValueOnce(new Error('链接索引已变化'))
    .mockImplementation(() => new Promise(resolve => { completions.push(resolve) }))
  const view = await openAndMove('move-to')
  fireEvent.click(await screen.findByRole('button', { name: '重新生成链接修复预览' }))
  await waitFor(() => expect(completions).toHaveLength(2))
  view.rerender(<MoveToDialog isOpen={false} sources={['/src/a.md', '/src/b.md']} onClose={view.onClose} />)
  view.rerender(<MoveToDialog isOpen sources={['/src/a.md', '/src/b.md']} onClose={view.onClose} />)
  await act(async () => { completions.forEach((complete, index) => complete(makePlan(`receipt-${index}`))) })
  fireEvent.click(await screen.findByText('src'))
  fireEvent.click(await screen.findByText('archive'))
  expect(screen.queryByRole('button', { name: '查看可更新的链接' })).toBeNull()
  expect(screen.queryByRole('button', { name: '重新生成链接修复预览' })).toBeNull()
  await waitFor(() => expect(screen.getByRole('button', { name: '移动 2 项' })).not.toBeDisabled())
})
