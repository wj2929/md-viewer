// @ts-nocheck - 测试文件的类型检查暂时跳过
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MoveToDialog } from '../../src/components/MoveToDialog'

describe('MoveToDialog', () => {
  const history = [
    { id: 'h1', path: '/roots/alpha', name: 'alpha', lastOpened: 2 },
    { id: 'h2', path: '/roots/beta', name: 'beta', lastOpened: 1 }
  ]

  beforeEach(() => {
    window.api = {
      getFolderHistory: vi.fn().mockResolvedValue(history),
      listChildDirs: vi.fn().mockResolvedValue([
        { name: 'sub1', path: '/roots/alpha/sub1' },
        { name: 'sub2', path: '/roots/alpha/sub2' }
      ]),
      moveFileToFolder: vi.fn().mockResolvedValue('/roots/alpha/note.md')
    } as any
    vi.spyOn(window, 'confirm').mockReturnValue(true)
  })

  afterEach(() => {
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
    await act(async () => { fireEvent.click(screen.getByText('移动')) })

    expect(window.api.moveFileToFolder).toHaveBeenCalledWith('/src/note.md', 'h1', '')
    expect(onSuccess).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('下钻子目录后移动 → subRelPath 为相对子路径', async () => {
    render(<MoveToDialog isOpen sources={['/src/note.md']} onClose={vi.fn()} />)
    const alpha = await screen.findByText('alpha')
    await act(async () => { fireEvent.click(alpha) })
    const sub1 = await screen.findByText('sub1')
    await act(async () => { fireEvent.click(sub1) })
    await act(async () => { fireEvent.click(screen.getByText('移动')) })

    expect(window.api.moveFileToFolder).toHaveBeenCalledWith('/src/note.md', 'h1', 'sub1')
  })

  it('源已在目标目录（同目录）→ 该根禁选', async () => {
    // 源就在 /roots/alpha 下，选 alpha 根即 no-op，应禁用移动
    render(<MoveToDialog isOpen sources={['/roots/alpha/note.md']} onClose={vi.fn()} />)
    const alpha = await screen.findByText('alpha')
    await act(async () => { fireEvent.click(alpha) })
    const moveBtn = screen.getByText('移动')
    expect(moveBtn.disabled).toBe(true)
  })

  it('多项移动逐个调 moveFileToFolder', async () => {
    render(
      <MoveToDialog isOpen sources={['/src/a.md', '/src/b.md']} onClose={vi.fn()} />
    )
    const alpha = await screen.findByText('alpha')
    await act(async () => { fireEvent.click(alpha) })
    await act(async () => { fireEvent.click(screen.getByText('移动')) })

    expect(window.api.moveFileToFolder).toHaveBeenCalledTimes(2)
  })

  it('用户取消 confirm → 不调 moveFileToFolder', async () => {
    window.confirm.mockReturnValue(false)
    render(<MoveToDialog isOpen sources={['/src/note.md']} onClose={vi.fn()} />)
    const alpha = await screen.findByText('alpha')
    await act(async () => { fireEvent.click(alpha) })
    await act(async () => { fireEvent.click(screen.getByText('移动')) })

    expect(window.api.moveFileToFolder).not.toHaveBeenCalled()
  })

  it('isOpen=false 不渲染', () => {
    const { container } = render(<MoveToDialog isOpen={false} sources={[]} onClose={vi.fn()} />)
    expect(container.firstChild).toBeNull()
  })
})
