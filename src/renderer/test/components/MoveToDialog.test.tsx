// @ts-nocheck - 测试文件的类型检查暂时跳过
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MoveToDialog } from '../../src/components/MoveToDialog'
import { useWorkspaceStore } from '../../src/stores/workspaceStore'

describe('MoveToDialog', () => {
  const history = [
    { id: 'h1', path: '/roots/alpha', name: 'alpha', lastOpened: 2 },
    { id: 'h2', path: '/roots/beta', name: 'beta', lastOpened: 1 }
  ]

  beforeEach(() => {
    useWorkspaceStore.setState({
      workspaces: [{ id: 'workspace-a', name: '测试工作区', primaryRoot: '/src', lifecycleEpoch: 1 }],
      activeWorkspaceId: 'workspace-a',
      runtimes: {},
    })
    window.api = {
      getFolderHistory: vi.fn().mockResolvedValue(history),
      listChildDirs: vi.fn().mockResolvedValue([
        { name: 'sub1', path: '/roots/alpha/sub1' },
        { name: 'sub2', path: '/roots/alpha/sub2' }
      ]),
      moveFileToFolder: vi.fn().mockResolvedValue('/roots/alpha/note.md'),
      previewCrossRootMoveImpact: vi.fn().mockResolvedValue({
        reportOnly: true,
        origin: { markdownDocumentsScanned: 2, localMarkdownLinksExamined: 1, linksBreakingAfterMove: 1, linksResolvingAfterMove: 0, linksChangingResolution: 0 },
        moved: { markdownDocumentsScanned: 1, localMarkdownLinksExamined: 1, linksBreakingAfterMove: 1, linksResolvingAfterMove: 0, linksChangingResolution: 0 },
        target: { markdownDocumentsScanned: 2, localMarkdownLinksExamined: 1, linksBreakingAfterMove: 0, linksResolvingAfterMove: 1, linksChangingResolution: 0 },
        coverage: { originIndexedMarkdownDocuments: 3, targetIndexedMarkdownDocuments: 2, ignoredLinks: 0, uncertainLinks: 0 },
      }),
      createLinkImpact: vi.fn().mockResolvedValue({ impactId: 'impact-a', affectedSourceFiles: 0, exactChanges: 0, candidates: 0, items: [] }),
      executeLinkRewriteOperation: vi.fn().mockResolvedValue({
        newPath: '/src/archive/note.md',
        receipt: { operationReceiptId: 'receipt-a' },
      }),
      createLinkRepairPlan: vi.fn().mockResolvedValue({ planId: 'plan-a', operationReceiptId: 'receipt-a', changes: [], warnings: [] }),
      applyLinkRepairPlan: vi.fn().mockResolvedValue({ planId: 'plan-a', files: [] }),
      applyLinkRepairPlans: vi.fn().mockResolvedValue({ planIds: ['plan-a'], files: [] }),
      regenerateLinkRepairPlan: vi.fn(),
      discardLinkRepairPlan: vi.fn().mockResolvedValue(undefined),
    } as any
    vi.spyOn(window, 'confirm').mockReturnValue(true)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('打开时列出文件夹历史', async () => {
    render(<MoveToDialog isOpen sources={['/src/note.md']} onClose={vi.fn()} />)
    expect(await screen.findByText('alpha')).toBeTruthy()
    expect(screen.getByText('beta')).toBeTruthy()
  })

  it('选中根后懒加载子目录树', async () => {
    render(<MoveToDialog isOpen sources={['/src/note.md']} onClose={vi.fn()} />)
    const alpha = await screen.findByText('alpha')
    await act(async () => { fireEvent.click(alpha) })
    expect(window.api.listChildDirs).toHaveBeenCalledWith('/roots/alpha')
    expect(await screen.findByText('sub1')).toBeTruthy()
  })

  it('选根后点移动 → 调 moveFileToFolder(源, historyId, "")', async () => {
    const onClose = vi.fn()
    const onSuccess = vi.fn()
    render(
      <MoveToDialog isOpen sources={['/src/note.md']} onClose={onClose} onMoveSuccess={onSuccess} />
    )
    const alpha = await screen.findByText('alpha')
    await act(async () => { fireEvent.click(alpha) })
    // 默认目标 = 根本身
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /移动 \d+ 项/ })) })

    await waitFor(() => expect(window.api.moveFileToFolder).toHaveBeenCalledWith('/src/note.md', 'h1', '', { workspaceId: 'workspace-a', lifecycleEpoch: 1 }))
    expect(onSuccess).toHaveBeenCalled()
    expect(await screen.findByRole('heading', { name: /移动结果/ })).toBeTruthy()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('下钻子目录后移动 → subRelPath 为相对子路径', async () => {
    render(<MoveToDialog isOpen sources={['/src/note.md']} onClose={vi.fn()} />)
    const alpha = await screen.findByText('alpha')
    await act(async () => { fireEvent.click(alpha) })
    const sub1 = await screen.findByText('sub1')
    await act(async () => { fireEvent.click(sub1) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /移动 \d+ 项/ })) })

    expect(window.api.moveFileToFolder).toHaveBeenCalledWith('/src/note.md', 'h1', 'sub1', { workspaceId: 'workspace-a', lifecycleEpoch: 1 })
  })

  it('源已在目标目录（同目录）→ 该根禁选', async () => {
    // 源就在 /roots/alpha 下，选 alpha 根即 no-op，应禁用移动
    render(<MoveToDialog isOpen sources={['/roots/alpha/note.md']} onClose={vi.fn()} />)
    const alpha = await screen.findByText('alpha')
    await act(async () => { fireEvent.click(alpha) })
    const moveBtn = screen.getByRole('button', { name: /移动 \d+ 项/ })
    expect(moveBtn.disabled).toBe(true)
  })

  it('多项移动逐个调 moveFileToFolder', async () => {
    render(
      <MoveToDialog isOpen sources={['/src/a.md', '/src/b.md']} onClose={vi.fn()} />
    )
    const alpha = await screen.findByText('alpha')
    await act(async () => { fireEvent.click(alpha) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /移动 \d+ 项/ })) })

    expect(window.api.moveFileToFolder).toHaveBeenCalledTimes(2)
  })

  it('取消按钮不执行移动', async () => {
    const onClose = vi.fn()
    render(<MoveToDialog isOpen sources={['/src/note.md']} onClose={onClose} />)
    const alpha = await screen.findByText('alpha')
    await act(async () => { fireEvent.click(alpha) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '取消' })) })

    expect(window.api.moveFileToFolder).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('按目录名称即时过滤最近打开的目录', async () => {
    render(<MoveToDialog isOpen sources={['/src/note.md']} onClose={vi.fn()} />)
    expect(await screen.findByText('alpha')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('搜索移动目标目录'), { target: { value: 'beta' } })

    expect(screen.queryByText('alpha')).toBeNull()
    expect(screen.getByText('beta')).toBeTruthy()
    expect(screen.getByText('最近打开的目录 · 1/2')).toBeTruthy()
  })

  it('按完整路径过滤最近打开的目录，不搜索子目录', async () => {
    render(<MoveToDialog isOpen sources={['/src/note.md']} onClose={vi.fn()} />)
    await screen.findByText('alpha')

    const input = screen.getByLabelText('搜索移动目标目录')
    fireEvent.change(input, { target: { value: '/roots/alpha' } })
    expect(screen.getByText('alpha')).toBeTruthy()
    expect(screen.queryByText('beta')).toBeNull()

    fireEvent.change(input, { target: { value: 'sub1' } })
    expect(screen.queryByText('alpha')).toBeNull()
    expect(screen.queryByText('sub1')).toBeNull()
    expect(screen.getByText('未找到匹配的最近打开目录')).toBeTruthy()
  })

  it('选择过滤结果后保留搜索条件和过滤列表', async () => {
    render(<MoveToDialog isOpen sources={['/src/note.md']} onClose={vi.fn()} />)
    await screen.findByText('alpha')

    const input = screen.getByLabelText('搜索移动目标目录')
    fireEvent.change(input, { target: { value: 'beta' } })
    await act(async () => { fireEvent.click(screen.getByText('beta')) })

    expect(input.value).toBe('beta')
    expect(screen.queryByText('alpha')).toBeNull()
    expect(screen.getByText('beta')).toBeTruthy()
    expect(await screen.findByText('sub1')).toBeTruthy()
  })

  it('清空过滤后恢复全部最近打开目录', async () => {
    render(<MoveToDialog isOpen sources={['/src/note.md']} onClose={vi.fn()} />)
    await screen.findByText('alpha')

    fireEvent.change(screen.getByLabelText('搜索移动目标目录'), { target: { value: 'beta' } })
    expect(screen.queryByText('alpha')).toBeNull()
    fireEvent.click(screen.getByLabelText('清空目录搜索'))

    expect(screen.getByText('alpha')).toBeTruthy()
    expect(screen.getByText('beta')).toBeTruthy()
  })

  it('same-root 移动先预览影响，物理移动后单独确认并应用修复', async () => {
    const sameRoot = { id: 'same', path: '/src', name: 'src', lastOpened: 3 }
    window.api.getFolderHistory.mockResolvedValueOnce([sameRoot])
    window.api.listChildDirs.mockResolvedValue([{ name: 'archive', path: '/src/archive' }])
    window.api.moveFileToFolder.mockResolvedValue('/src/archive/note.md')
    window.api.createLinkImpact.mockResolvedValue({
      impactId: 'impact-a',
      mapping: { oldRelativePath: 'note.md', newRelativePath: 'archive/note.md' },
      affectedSourceFiles: 1, exactChanges: 1, candidates: 0, items: [],
    })
    window.api.createLinkRepairPlan.mockResolvedValue({
      planId: 'plan-a',
      operationReceiptId: 'receipt-a',
      changes: [{ changeId: 'change-a', sourceRelativePath: 'index.md', lineStart: 3, before: './note.md', after: './archive/note.md' }],
      warnings: [],
    })
    window.api.applyLinkRepairPlans.mockResolvedValue({
      planIds: ['plan-a'], files: [{ sourceRelativePath: 'index.md', status: 'updated', updatedChanges: 1 }],
    })
    const onSuccess = vi.fn()
    render(<MoveToDialog isOpen sources={['/src/note.md']} onClose={vi.fn()} onMoveSuccess={onSuccess} />)

    const sameRootItem = await screen.findByText('src')
    fireEvent.click(sameRootItem)
    const archive = await screen.findByText('archive')
    fireEvent.click(archive)
    await waitFor(() => expect(window.api.createLinkImpact).toHaveBeenCalledWith(
      { workspaceId: 'workspace-a', lifecycleEpoch: 1 },
      { oldRelativePath: 'note.md', newRelativePath: 'archive/note.md' },
    ))
    await waitFor(() => expect(screen.getByRole('button', { name: /移动 \d+ 项/ })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: /移动 \d+ 项/ }))
    await waitFor(() => expect(window.api.executeLinkRewriteOperation).toHaveBeenCalledWith(
      { workspaceId: 'workspace-a', lifecycleEpoch: 1 },
      {
        impactId: 'impact-a',
        mapping: { oldRelativePath: 'note.md', newRelativePath: 'archive/note.md' },
        reason: 'move',
        confirm: true,
      },
    ))
    await waitFor(() => expect(window.api.createLinkRepairPlan).toHaveBeenCalledWith(
      { workspaceId: 'workspace-a', lifecycleEpoch: 1 },
      { oldRelativePath: 'note.md', newRelativePath: 'archive/note.md' },
      'move',
      'receipt-a',
    ))
    fireEvent.click(await screen.findByRole('button', { name: '查看可更新的链接' }))
    expect(screen.getByText('− ./note.md')).toBeTruthy()
    expect(screen.getByText('+ ./archive/note.md')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /更新 1 个文件中的 1 处链接/ }))
    await waitFor(() => expect(window.api.applyLinkRepairPlans).toHaveBeenCalledWith(
      { workspaceId: 'workspace-a', lifecycleEpoch: 1 },
      {
        plans: [{ planId: 'plan-a', operationReceiptId: 'receipt-a', selectedChangeIds: ['change-a'] }],
        confirm: true,
      },
    ))
    expect(await screen.findByRole('heading', { name: /链接修复结果/ })).toBeTruthy()
    expect(onSuccess).toHaveBeenCalledWith('链接修复完成')
  })

  it('跨根移动显示双侧只读影响统计且不创建修复计划', async () => {
    window.api.getFolderHistory.mockResolvedValueOnce(history)
    render(<MoveToDialog isOpen sources={['/src/note.md']} onClose={vi.fn()} />)
    const alpha = await screen.findByText('alpha')
    fireEvent.click(alpha)
    await waitFor(() => expect(window.api.previewCrossRootMoveImpact).toHaveBeenCalledWith(
      ['/src/note.md'], 'h1', '', { workspaceId: 'workspace-a', lifecycleEpoch: 1 },
    ))
    expect(await screen.findByText(/来源工作区将断开 1 处链接/)).toBeTruthy()
    expect(screen.getByText(/目标工作区将新增解析 1 处/)).toBeTruthy()
    expect(screen.getByText(/不会自动修改来源或目标工作区中的任何链接/)).toBeTruthy()
    await waitFor(() => expect(screen.getByRole('button', { name: /移动 \d+ 项/ })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: /移动 \d+ 项/ }))
    await waitFor(() => expect(window.api.moveFileToFolder).toHaveBeenCalled())
    expect(window.api.createLinkImpact).not.toHaveBeenCalled()
    expect(window.api.createLinkRepairPlan).not.toHaveBeenCalled()
  })

  it('isOpen=false 不渲染', () => {
    const { container } = render(<MoveToDialog isOpen={false} sources={[]} onClose={vi.fn()} />)
    expect(container.firstChild).toBeNull()
  })
})
