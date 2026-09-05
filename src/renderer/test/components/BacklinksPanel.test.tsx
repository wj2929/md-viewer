import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import BacklinksPanel from '../../src/components/BacklinksPanel'
import { useWorkspaceStore } from '../../src/stores/workspaceStore'

const sourceRange = (startOffset: number, line: number) => ({
  startOffset,
  endOffset: startOffset + 10,
  startLine: line,
  startColumn: 1,
  endLine: line,
  endColumn: 11,
})

describe('BacklinksPanel', () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      workspaces: [{ id: 'workspace-a', primaryRoot: '/workspace', lifecycleEpoch: 1, name: 'workspace' }],
      activeWorkspaceId: 'workspace-a',
      runtimes: {},
    })
    global.window.api = {
      ...(global.window.api || {}),
      getWorkspaceIndexStatus: vi.fn().mockResolvedValue({
        state: 'ready', generation: 1, indexedDocuments: 3, totalDocuments: 3, pendingDocuments: 0, errors: 0,
      }),
      subscribeWorkspaceIndexStatus: vi.fn(() => () => {}),
      rebuildWorkspaceIndex: vi.fn(),
    } as any
  })

  it('只有其他链接时默认收起并按来源逐级展开', async () => {
    const items = [
      ['docs/katex.md', 'katex.md', 3, 1, 'standalone-link', '分类目录 · 示例包首页'],
      ['docs/katex.md', 'katex.md', 393, 20, 'standalone-link', '分类目录 · 示例包首页'],
      ['docs/markmap.md', 'markmap.md', 3, 40, 'standalone-link', '分类目录 · 示例包首页'],
      ['docs/markmap.md', 'markmap.md', 1152, 60, 'standalone-link', '分类目录 · 示例包首页'],
      ['README.md', 'README.md', 16, 80, 'table', '公式与知识 · 33 · 本地'],
    ].map(([sourceRelativePath, sourceDisplayName, lineStart, offset, placement, context]) => ({
      sourceRelativePath,
      sourceDisplayName,
      lineStart,
      rawTarget: './target.md',
      context,
      placement,
      sourceRange: sourceRange(offset as number, lineStart as number),
    }))
    ;(window.api.getWorkspaceBacklinks as any) = vi.fn().mockResolvedValue(items)
    const onSelect = vi.fn()

    render(
      <BacklinksPanel
        targetRelativePath="docs/README.md"
        onSelect={onSelect}
        onClose={vi.fn()}
      />
    )

    expect(await screen.findByText('3 个文档 · 5 处链接')).toBeInTheDocument()
    expect(screen.getByText('没有正文提及')).toBeInTheDocument()
    expect(screen.queryByText('katex.md')).not.toBeInTheDocument()

    const otherLinks = screen.getByRole('button', { name: /其他链接/ })
    expect(otherLinks).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(otherLinks)
    expect(screen.getByText('katex.md')).toBeInTheDocument()
    expect(screen.getAllByText('docs/')).toHaveLength(1)
    expect(screen.getByText('根目录')).toBeInTheDocument()

    const readme = screen.getByRole('button', { name: '打开 README.md 的表格，第 16 行' })
    expect(readme).not.toHaveAttribute('aria-expanded')
    fireEvent.click(readme)
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ lineStart: 16 }))
    onSelect.mockClear()

    const katex = screen.getByRole('button', { name: /katex.md/ })
    expect(katex).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(katex)
    expect(onSelect).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '打开 katex.md 的独立链接，第 3 行' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '打开 katex.md 的独立链接，第 393 行' }))
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ lineStart: 393 }))
  })
})
