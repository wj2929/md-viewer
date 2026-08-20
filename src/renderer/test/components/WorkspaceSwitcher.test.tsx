import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { WorkspaceSwitcher } from '../../src/components/WorkspaceSwitcher'

const workspaces = [
  { id: 'one', name: '小说正文', primaryRoot: '/docs/novel', lifecycleEpoch: 1 },
  { id: 'two', name: '需求评审', primaryRoot: '/docs/spec', lifecycleEpoch: 1 },
]

const summaries = {
  one: { tabCount: 1, hasSplit: false, hasDraft: false, hasMeaningfulState: true },
  two: { tabCount: 1, hasSplit: false, hasDraft: false, hasMeaningfulState: true },
}

describe('WorkspaceSwitcher', () => {
  it('单工作区时不显示', () => {
    const { container } = render(
      <WorkspaceSwitcher workspaces={[workspaces[0]]} activeWorkspaceId="one" summaries={summaries} onSelect={vi.fn()} />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('隐藏非当前且只有目录根的空会话', () => {
    const { container } = render(
      <WorkspaceSwitcher
        workspaces={workspaces}
        activeWorkspaceId="one"
        summaries={{
          one: summaries.one,
          two: { tabCount: 0, hasSplit: false, hasDraft: false, hasMeaningfulState: false },
        }}
        onSelect={vi.fn()}
      />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('显示当前名称并切换到选定工作区', () => {
    const onSelect = vi.fn()
    render(<WorkspaceSwitcher workspaces={workspaces} activeWorkspaceId="one" summaries={summaries} onSelect={onSelect} />)

    fireEvent.click(screen.getByRole('button', { name: /工作区：小说正文/ }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: /需求评审/ }))

    expect(onSelect).toHaveBeenCalledWith('two')
  })

  it('关闭菜单后打开独立的合并入口', () => {
    const onMergeOtherWindows = vi.fn()
    render(
      <WorkspaceSwitcher
        workspaces={workspaces}
        activeWorkspaceId="one" summaries={summaries}
        onSelect={vi.fn()}
        onMergeOtherWindows={onMergeOtherWindows}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /工作区：小说正文/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: '合并其他窗口' }))

    expect(onMergeOtherWindows).toHaveBeenCalledOnce()
    expect(screen.queryByRole('menu', { name: '工作区' })).not.toBeInTheDocument()
  })

  it('提供拆分操作', () => {
    const onSplitActive = vi.fn()
    render(
      <WorkspaceSwitcher
        workspaces={workspaces}
        activeWorkspaceId="one" summaries={summaries}
        onSelect={vi.fn()}
        onSplitActive={onSplitActive}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /工作区：小说正文/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: '将当前工作区拆分为新窗口' }))
    expect(onSplitActive).toHaveBeenCalledOnce()
  })
})
