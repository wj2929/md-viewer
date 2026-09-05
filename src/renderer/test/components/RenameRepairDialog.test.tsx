import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { RenameRepairDialog } from '../../src/components/RenameRepairDialog'

const operation = { workspaceId: 'workspace-a', lifecycleEpoch: 1 }
const mapping = { oldRelativePath: 'docs/a.md', newRelativePath: 'docs/b.md' }
const impact = {
  impactId: 'impact-a',
  createdAt: 1,
  expiresAt: 2,
  mapping,
  affectedSourceFiles: 1,
  exactChanges: 1,
  candidates: 0,
  items: [{
    sourceRelativePath: 'index.md', lineStart: 3, rawTarget: './docs/a.md',
    resolvedTargetRelativePath: 'docs/b.md', relation: 'inbound', confidence: 'exact',
  }],
} as const

beforeEach(() => {
  window.api = {
    executeLinkRewriteOperation: vi.fn().mockResolvedValue({
      newPath: '/workspace/docs/b.md',
      receipt: { operationReceiptId: 'receipt-a' },
    }),
    createLinkRepairPlan: vi.fn().mockResolvedValue({
      planId: 'plan-a', operationReceiptId: 'receipt-a', createdAt: 1, expiresAt: 2, mapping,
      changes: [{
        changeId: 'change-a', sourceRelativePath: 'index.md', lineStart: 3,
        sourceRevisionToken: 'revision', destinationRange: {
          startOffset: 10, endOffset: 21, startLine: 3, startColumn: 2, endLine: 3, endColumn: 13,
        },
        before: './docs/a.md', after: './docs/b.md', reason: 'rename', confidence: 'exact',
      }], warnings: [],
    }),
    applyLinkRepairPlan: vi.fn().mockResolvedValue({
      planId: 'plan-a', files: [{ sourceRelativePath: 'index.md', status: 'updated', updatedChanges: 1 }],
    }),
    regenerateLinkRepairPlan: vi.fn(),
    discardLinkRepairPlan: vi.fn().mockResolvedValue(undefined),
  } as any
})

describe('RenameRepairDialog', () => {
  it('在单一向导中完成 impact、物理重命名、diff 和修复结果', async () => {
    const onMoved = vi.fn()
    render(<RenameRepairDialog
      operation={operation}
      oldPath="/workspace/docs/a.md"
      newName="b.md"
      mapping={mapping}
      impact={impact as any}
      onMoved={onMoved}
      onClose={vi.fn()}
    />)

    expect(screen.getByRole('heading', { name: /重命名影响/ })).toBeTruthy()
    expect(screen.getByText(/1 个来源文件可能受影响/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '重命名文件' }))
    await waitFor(() => expect(window.api.executeLinkRewriteOperation).toHaveBeenCalledWith(operation, {
      impactId: 'impact-a', mapping, reason: 'rename', confirm: true,
    }))
    expect(await screen.findByRole('heading', { name: /重命名结果/ })).toBeTruthy()
    expect(onMoved).toHaveBeenCalledWith('/workspace/docs/b.md')

    fireEvent.click(screen.getByRole('button', { name: '查看可更新的链接' }))
    expect(screen.getByText('− ./docs/a.md')).toBeTruthy()
    expect(screen.getByText('+ ./docs/b.md')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /更新 1 个文件中的 1 处链接/ }))
    await waitFor(() => expect(window.api.applyLinkRepairPlan).toHaveBeenCalledWith(operation, {
      planId: 'plan-a', operationReceiptId: 'receipt-a', selectedChangeIds: ['change-a'], confirm: true,
    }))
    expect(await screen.findByRole('heading', { name: /链接修复结果/ })).toBeTruthy()
  })

  it('取消影响页不执行物理重命名', () => {
    const onClose = vi.fn()
    render(<RenameRepairDialog
      operation={operation}
      oldPath="/workspace/docs/a.md"
      newName="b.md"
      mapping={mapping}
      impact={impact as any}
      onMoved={vi.fn()}
      onClose={onClose}
    />)
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(window.api.executeLinkRewriteOperation).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })
})
