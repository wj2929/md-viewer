import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FileTreeMoveRepairDialog } from '../../src/components/FileTreeMoveRepairDialog'

const operation = { workspaceId: 'workspace-a', lifecycleEpoch: 1 }
const mapping = { oldRelativePath: 'a.md', newRelativePath: 'docs/a.md' }
const impact = {
  impactId: 'impact-a',
  createdAt: 1,
  expiresAt: 2,
  mapping,
  affectedSourceFiles: 1,
  exactChanges: 1,
  candidates: 0,
  items: [{
    sourceRelativePath: 'index.md',
    lineStart: 3,
    rawTarget: './a.md',
    resolvedTargetRelativePath: 'docs/a.md',
    relation: 'inbound',
    confidence: 'exact',
  }],
} as const

beforeEach(() => {
  window.api = {
    executeLinkRewriteOperation: vi.fn().mockResolvedValue({
      newPath: '/workspace/docs/a.md',
      receipt: { operationReceiptId: 'receipt-a' },
    }),
    createLinkRepairPlan: vi.fn().mockResolvedValue({
      planId: 'plan-a',
      operationReceiptId: 'receipt-a',
      createdAt: 1,
      expiresAt: 2,
      mapping,
      changes: [{
        changeId: 'change-a',
        sourceRelativePath: 'index.md',
        lineStart: 3,
        sourceRevisionToken: 'revision',
        destinationRange: {
          startOffset: 10,
          endOffset: 16,
          startLine: 3,
          startColumn: 2,
          endLine: 3,
          endColumn: 8,
        },
        before: './a.md',
        after: './docs/a.md',
        reason: 'move',
        confidence: 'exact',
      }],
      warnings: [],
    }),
    applyLinkRepairPlans: vi.fn().mockResolvedValue({
      planIds: ['plan-a'],
      files: [{ sourceRelativePath: 'index.md', status: 'updated', updatedChanges: 1 }],
    }),
    regenerateLinkRepairPlan: vi.fn(),
    discardLinkRepairPlan: vi.fn().mockResolvedValue(undefined),
  } as any
})

describe('FileTreeMoveRepairDialog', () => {
  it('物理移动和 Markdown 修复需要两次独立授权', async () => {
    render(<FileTreeMoveRepairDialog
      operation={operation}
      sources={['/workspace/a.md']}
      targetDir="/workspace/docs"
      mappings={[mapping]}
      impacts={[impact as any]}
      onClose={vi.fn()}
    />)

    expect(screen.getByRole('heading', { name: /移动影响/ })).toBeTruthy()
    expect(window.api.executeLinkRewriteOperation).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '移动 1 项' }))
    await waitFor(() => expect(window.api.executeLinkRewriteOperation).toHaveBeenCalledWith(operation, {
      impactId: 'impact-a', mapping, reason: 'move', confirm: true,
    }))
    expect(await screen.findByRole('heading', { name: /移动结果/ })).toBeTruthy()
    expect(window.api.applyLinkRepairPlans).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '查看可更新的链接' }))
    expect(screen.getByText('− ./a.md')).toBeTruthy()
    expect(screen.getByText('+ ./docs/a.md')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /更新 1 个文件中的 1 处链接/ }))
    await waitFor(() => expect(window.api.applyLinkRepairPlans).toHaveBeenCalledWith(operation, {
      plans: [{ planId: 'plan-a', operationReceiptId: 'receipt-a', selectedChangeIds: ['change-a'] }],
      confirm: true,
    }))
    expect(await screen.findByRole('heading', { name: /链接修复结果/ })).toBeTruthy()
  })

  it('批量移动部分失败时只为成功项生成修复计划', async () => {
    const secondMapping = { oldRelativePath: 'b.md', newRelativePath: 'docs/b.md' }
    const secondImpact = { ...impact, impactId: 'impact-b', mapping: secondMapping }
    ;(window.api.executeLinkRewriteOperation as any)
      .mockResolvedValueOnce({ newPath: '/workspace/docs/a.md', receipt: { operationReceiptId: 'receipt-a' } })
      .mockRejectedValueOnce(new Error('目标文件已存在'))
    const onMoveError = vi.fn()

    render(<FileTreeMoveRepairDialog
      operation={operation}
      sources={['/workspace/a.md', '/workspace/b.md']}
      targetDir="/workspace/docs"
      mappings={[mapping, secondMapping]}
      impacts={[impact as any, secondImpact as any]}
      onMoveError={onMoveError}
      onClose={vi.fn()}
    />)

    fireEvent.click(screen.getByRole('button', { name: '移动 2 项' }))
    expect(await screen.findByText('1 项成功 · 1 项失败')).toBeTruthy()
    expect(screen.getByText('目标文件已存在')).toBeTruthy()
    expect(window.api.createLinkRepairPlan).toHaveBeenCalledTimes(1)
    expect(window.api.createLinkRepairPlan).toHaveBeenCalledWith(operation, mapping, 'move', 'receipt-a')
    expect(onMoveError).toHaveBeenCalledWith('已移动 1 项，1 项失败')
  })

  it('取消影响页不执行移动', () => {
    const onClose = vi.fn()
    render(<FileTreeMoveRepairDialog
      operation={operation}
      sources={['/workspace/a.md']}
      targetDir="/workspace/docs"
      mappings={[mapping]}
      impacts={[impact as any]}
      onClose={onClose}
    />)

    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(window.api.executeLinkRewriteOperation).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })
})
