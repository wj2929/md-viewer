import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createRef } from 'react'
import { FileBrowserPanel, type FileBrowserPanelHandle } from '../../src/components/FileBrowserPanel'
import { useBrowserSortStore } from '../../src/stores/browserSortStore'
import { useFileTreeSortStore } from '../../src/stores/fileTreeSortStore'
import type { FileTreeSort } from '../../../shared/fileTreeSort'
import type { WorkspaceDirectoryEntry } from '../../../shared/directoryBrowser'

const operation = { workspaceId: 'fixture', lifecycleEpoch: 1 }
const directory = (name: string): WorkspaceDirectoryEntry => ({ name, relativePath: name, kind: 'directory' })
const file = (name: string, relativePath = name): WorkspaceDirectoryEntry => ({ name, relativePath, kind: 'file' })
const initial = [directory('assets'), directory('empty'), directory('node_modules'), directory('.hidden'), file('README.md'), file('数据 #?%.json')]

function mount(open = true) {
  const onSelect = vi.fn()
  const onClose = vi.fn()
  const props = { open, operation, rootName: 'synthetic-root', onSelect, onClose }
  return { ...render(<FileBrowserPanel {...props} />), props, onSelect, onClose }
}

describe('FileBrowserPanel', () => {
  beforeEach(() => {
    useBrowserSortStore.setState({ value: { by: 'name', direction: 'asc' }, revision: -1, ready: false, saving: false, error: null, localChange: 0 })
    let value: FileTreeSort = { by: 'name', direction: 'asc' }
    let revision = 0
    window.api = { ...window.api,
      getBrowserSort: vi.fn(async () => ({ value, revision })),
      onBrowserSortChanged: vi.fn(() => () => {}),
      updateAppSettings: vi.fn(async update => { value = update.browserSort!; revision++ }),
      listWorkspaceDirectory: vi.fn(async (_operation, relativePath) => relativePath === '' ? initial : relativePath === 'assets' ? [file('image.png', 'assets/image.png')] : []) }
  })

  it('groups sorting and directory actions while keeping reset and key explanations visible', async () => {
    const { container } = mount()
    await screen.findByRole('button', { name: 'README.md' })
    fireEvent.click(screen.getByLabelText('工作区文件操作'))
    const reset = screen.getByRole('button', { name: '恢复默认排序' })
    expect(reset.closest('.browser-sort-heading')).toHaveTextContent('排序')
    expect(reset).toBeDisabled()
    expect(screen.getByText('仅工作区文件 · 跨目录和窗口自动保存')).toBeVisible()
    expect(screen.getByText('文件夹优先，每层分别排序')).toBeVisible()
    expect(screen.getByRole('checkbox', { name: '显示隐藏文件' }).closest('.browser-display-options')).not.toBeNull()
    const actions = container.querySelector('.browser-menu-actions')!
    expect(actions).toContainElement(screen.getByRole('button', { name: '刷新工作区文件' }))
    expect(actions).toContainElement(screen.getByRole('button', { name: '折叠全部' }))
    act(() => useBrowserSortStore.setState({ value: { by: 'modified', direction: 'desc' } }))
    expect(screen.getByText('文件夹按自身修改时间，不汇总内部文件')).toBeVisible()
    expect(screen.getByText('属性不可读的项排在同组末尾，不递归扫描')).toBeVisible()
  })

  it('saves independent sorting without touching the document tree or rereading name-only rules', async () => {
    const originalTreeSort = useFileTreeSortStore.getState().value
    vi.mocked(window.api.listWorkspaceDirectory).mockResolvedValue([file('10.txt'), file('2.txt'), file('1.txt')])
    mount()
    await screen.findByRole('button', { name: '10.txt' })
    fireEvent.click(screen.getByLabelText('工作区文件操作'))
    const natural = screen.getByRole('radio', { name: '名称（自然数字）' })
    await waitFor(() => expect(natural).toBeEnabled())
    fireEvent.click(natural)
    await waitFor(() => expect(useBrowserSortStore.getState().value.by).toBe('natural'))
    expect([...document.querySelectorAll('.browser-tree > [role="treeitem"] > button')].map(node => node.textContent))
      .toEqual(['1.txt', '2.txt', '10.txt'])
    expect(window.api.updateAppSettings).toHaveBeenCalledWith({ browserSort: { by: 'natural', direction: 'asc' } })
    expect(useFileTreeSortStore.getState().value).toEqual(originalTreeSort)
    expect(window.api.listWorkspaceDirectory).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: '恢复默认排序' }))
    await waitFor(() => expect(useBrowserSortStore.getState().value.by).toBe('name'))
  })

  it('sorts all siblings before the 200 item limit and keeps selection, expansion and page allowance', async () => {
    const entries = [directory('assets'), ...Array.from({ length: 230 }, (_, i) => file(`file-${i}.txt`))]
    vi.mocked(window.api.listWorkspaceDirectory).mockImplementation(async (_op, path) => path ? [file('child.txt', 'assets/child.txt')] : entries)
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'assets' }))
    await screen.findByRole('button', { name: 'child.txt' })
    fireEvent.click(screen.getByRole('button', { name: 'file-0.txt' }))
    act(() => useBrowserSortStore.setState({ value: { by: 'natural', direction: 'desc' } }))
    expect(screen.getByRole('button', { name: 'file-229.txt' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'file-0.txt' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '显示更多（31）' }))
    expect(screen.getByRole('button', { name: 'file-0.txt' }).parentElement).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('button', { name: 'child.txt' })).toBeInTheDocument()
    act(() => useBrowserSortStore.setState({ value: { by: 'name', direction: 'asc' } }))
    expect(screen.queryByRole('button', { name: /显示更多/ })).toBeNull()
    expect(window.api.listWorkspaceDirectory).toHaveBeenCalledTimes(2)
  })

  it('keeps the prior order while attributes load and rejects a late result from the previous rule', async () => {
    let modified!: (entries: WorkspaceDirectoryEntry[]) => void
    let sizes!: (entries: WorkspaceDirectoryEntry[]) => void
    vi.mocked(window.api.listWorkspaceDirectory).mockImplementation((_op, _path, field) => field === 'modified'
      ? new Promise(resolve => { modified = resolve }) : field === 'size'
        ? new Promise(resolve => { sizes = resolve }) : Promise.resolve([file('10.txt'), file('2.txt')]))
    mount()
    await screen.findByRole('button', { name: '10.txt' })
    act(() => useBrowserSortStore.setState({ value: { by: 'natural', direction: 'asc' } }))
    const names = () => [...document.querySelectorAll('.browser-tree > [role="treeitem"] > button')].map(node => node.textContent)
    expect(names()).toEqual(['2.txt', '10.txt'])
    act(() => useBrowserSortStore.setState({ value: { by: 'modified', direction: 'desc' } }))
    expect(names()).toEqual(['2.txt', '10.txt'])
    act(() => useBrowserSortStore.setState({ value: { by: 'size', direction: 'desc' } }))
    await act(async () => modified([{ ...file('stale.txt'), mtimeMs: 99 }]))
    expect(screen.queryByRole('button', { name: 'stale.txt' })).toBeNull()
    await act(async () => sizes([{ ...file('10.txt'), size: 10 }, { ...file('2.txt'), size: 0 }]))
    expect(names()).toEqual(['10.txt', '2.txt'])
    fireEvent.change(screen.getByRole('textbox', { name: '过滤已加载项' }), { target: { value: '2' } })
    expect(window.api.listWorkspaceDirectory).toHaveBeenCalledTimes(3)
  })

  it('discards attributes invalidated by refresh, including the old request cleanup', async () => {
    const pending: Array<(entries: WorkspaceDirectoryEntry[]) => void> = []
    vi.mocked(window.api.listWorkspaceDirectory).mockImplementation((_op, _path, field) => field
      ? new Promise(resolve => { pending.push(resolve) }) : Promise.resolve([file('current.txt')]))
    const ref = createRef<FileBrowserPanelHandle>()
    render(<FileBrowserPanel ref={ref} open operation={operation} rootName="fixture" onClose={vi.fn()} onSelect={vi.fn()} />)
    await screen.findByRole('button', { name: 'current.txt' })
    act(() => useBrowserSortStore.setState({ value: { by: 'modified', direction: 'desc' } }))
    act(() => ref.current!.refresh())
    expect(pending).toHaveLength(2)
    await act(async () => pending[0]([{ ...file('old.txt'), mtimeMs: 99 }]))
    expect(screen.queryByRole('button', { name: 'old.txt' })).toBeNull()
    await act(async () => pending[1]([{ ...file('fresh.txt'), mtimeMs: 1 }]))
    await screen.findByRole('button', { name: 'fresh.txt' })
  })

  it('distinguishes folders from files using fixed-size shapes and a separate expansion indicator', async () => {
    vi.mocked(window.api.listWorkspaceDirectory).mockResolvedValueOnce([
      directory('folder'), ...['note.md', 'sheet.xlsx', 'photo.png', 'sound.mp3', 'clip.mp4', 'unknown.bin'].map(name => file(name)),
      { name: 'linked', relativePath: 'linked', kind: 'link' },
    ])
    mount()
    const folder = await screen.findByRole('button', { name: 'folder' })
    expect(folder.querySelector('.browser-entry-icon')).toHaveAttribute('data-kind', 'folder')
    expect(folder.querySelector('.browser-entry-chevron svg')).not.toHaveClass('expanded')
    const closed = folder.querySelector('.browser-entry-icon')!.innerHTML
    fireEvent.click(folder)
    expect(folder.querySelector('.browser-entry-chevron svg')).toHaveClass('expanded')
    expect(folder.querySelector('.browser-entry-icon')!.innerHTML).not.toBe(closed)
    for (const [name, kind] of [['note.md', 'markdown'], ['sheet.xlsx', 'table'], ['photo.png', 'image'], ['sound.mp3', 'audio'], ['clip.mp4', 'video'], ['unknown.bin', 'attachment'], ['linked', 'link']]) {
      const button = screen.getByRole('button', { name })
      expect(button.querySelector('.browser-entry-icon')).toHaveAttribute('data-kind', kind)
      expect(button.querySelector('.browser-entry-chevron svg')).toBeNull()
    }
    expect(screen.getByRole('button', { name: 'linked' })).toBeDisabled()
  })

  it('does not read anything while closed or select a default file', async () => {
    const { rerender, props, onSelect } = mount(false)
    expect(window.api.listWorkspaceDirectory).not.toHaveBeenCalled()
    rerender(<FileBrowserPanel {...props} open />)
    await screen.findByRole('button', { name: /README.md/ })
    expect(window.api.listWorkspaceDirectory).toHaveBeenCalledExactlyOnceWith(operation, '')
    expect(onSelect).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /.hidden/ })).toBeNull()
  })

  it('expands only the selected directory, displays empty directories and never scans a generated tree', async () => {
    mount()
    fireEvent.click(await screen.findByRole('button', { name: /assets/ }))
    await screen.findByRole('button', { name: /image.png/ })
    fireEvent.click(screen.getByRole('button', { name: /empty/ }))
    await screen.findByText('空文件夹')
    expect(vi.mocked(window.api.listWorkspaceDirectory).mock.calls.map(call => call[1])).toEqual(['', 'assets', 'empty'])
    expect(screen.getByRole('button', { name: /node_modules/ })).toBeInTheDocument()
  })

  it('filters loaded entries without IO and shows hidden entries only on request', async () => {
    mount()
    await screen.findByRole('button', { name: /README.md/ })
    fireEvent.change(screen.getByRole('textbox', { name: '过滤已加载项' }), { target: { value: 'image' } })
    await screen.findByText('没有匹配的已加载项')
    expect(window.api.listWorkspaceDirectory).toHaveBeenCalledTimes(1)
    fireEvent.change(screen.getByRole('textbox', { name: '过滤已加载项' }), { target: { value: '' } })
    fireEvent.click(screen.getByLabelText('工作区文件操作'))
    fireEvent.click(screen.getByRole('checkbox', { name: '显示隐藏文件' }))
    expect(screen.getByRole('button', { name: /.hidden/ })).toBeInTheDocument()
    expect(window.api.listWorkspaceDirectory).toHaveBeenCalledTimes(1)
  })

  it('allows text paste in the filter but blocks filesystem paste from the tree', async () => {
    mount()
    await screen.findByRole('button', { name: /README.md/ })
    const input = screen.getByRole('textbox', { name: '过滤已加载项' })
    const textPaste = new Event('paste', { bubbles: true, cancelable: true })
    fireEvent(input, textPaste)
    expect(textPaste.defaultPrevented).toBe(false)
    const filePaste = new Event('paste', { bubbles: true, cancelable: true })
    fireEvent(screen.getByRole('tree', { name: '完整目录' }), filePaste)
    expect(filePaste.defaultPrevented).toBe(true)
  })

  it('selects ordinary files without closing the browser and refreshes expanded directories on reopening', async () => {
    const { rerender, props, onSelect, onClose } = mount()
    fireEvent.click(await screen.findByRole('button', { name: /assets/ }))
    fireEvent.click(await screen.findByRole('button', { name: /image.png/ }))
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(file('image.png', 'assets/image.png'))
    expect(onClose).not.toHaveBeenCalled()
    rerender(<FileBrowserPanel {...props} open={false} />)
    rerender(<FileBrowserPanel {...props} />)
    await waitFor(() => expect(window.api.listWorkspaceDirectory).toHaveBeenCalledTimes(4))
    expect(screen.getByRole('button', { name: /image.png/ })).toBeInTheDocument()
  })

  it('shows a retryable error rather than an empty directory', async () => {
    vi.mocked(window.api.listWorkspaceDirectory).mockRejectedValueOnce(new Error('fixture permission denied'))
    mount()
    await screen.findByText('无法读取目录，请重试')
    expect(screen.queryByText('空文件夹')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    await screen.findByRole('button', { name: /README.md/ })
  })

  it('renders large directories in explicit batches without silently hiding the remainder', async () => {
    vi.mocked(window.api.listWorkspaceDirectory).mockResolvedValueOnce(Array.from({ length: 230 }, (_, index) => file(`file-${index}.txt`)))
    mount()
    await screen.findByRole('button', { name: /file-0.txt/ })
    expect(screen.queryByRole('button', { name: /file-229.txt/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '显示更多（30）' }))
    expect(screen.getByRole('button', { name: /file-229.txt/ })).toBeInTheDocument()
    expect(window.api.listWorkspaceDirectory).toHaveBeenCalledTimes(1)
  })

  it('routes entry and blank-area menus to independent relative targets without opening the item', async () => {
    const selection = { action: 'copy-path' as const, target: { ...file('README.md'), path: '/fixture/README.md', id: 'target' } }
    window.api.showWorkspaceContextMenu = vi.fn().mockResolvedValue(selection)
    const onAction = vi.fn().mockResolvedValue(undefined), onSelect = vi.fn()
    render(<FileBrowserPanel open operation={operation} rootName="fixture" onClose={vi.fn()} onSelect={onSelect} onAction={onAction} />)
    fireEvent.contextMenu(await screen.findByRole('button', { name: /README.md/ }))
    await waitFor(() => expect(onAction).toHaveBeenCalledWith(selection))
    expect(window.api.showWorkspaceContextMenu).toHaveBeenCalledExactlyOnceWith(operation, 'README.md')
    expect(onSelect).not.toHaveBeenCalled()
    fireEvent.contextMenu(screen.getByRole('tree'))
    await waitFor(() => expect(window.api.showWorkspaceContextMenu).toHaveBeenLastCalledWith(operation, ''))
  })

  it('discards a menu result from an unmounted workspace and handles cancelled menus', async () => {
    let finish!: (value: any) => void
    window.api.showWorkspaceContextMenu = vi.fn().mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const onAction = vi.fn()
    const { unmount } = render(<FileBrowserPanel open operation={operation} rootName="fixture" onClose={vi.fn()} onSelect={vi.fn()} onAction={onAction} />)
    fireEvent.contextMenu(await screen.findByRole('button', { name: /README.md/ }))
    unmount()
    await act(async () => finish({ action: 'trash', target: { id: 'old' } }))
    expect(onAction).not.toHaveBeenCalled()
  })

  it('invalidates renamed directory caches, preserves filters and reloads only loaded directories', async () => {
    const ref = createRef<FileBrowserPanelHandle>()
    render(<FileBrowserPanel ref={ref} open operation={operation} rootName="fixture" onClose={vi.fn()} onSelect={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: /assets/ }))
    await screen.findByRole('button', { name: /image.png/ })
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'image' } })
    vi.mocked(window.api.listWorkspaceDirectory).mockImplementation(async (_operation, value) => value === ''
      ? [directory('renamed')] : value === 'renamed' ? [file('image.png', 'renamed/image.png')] : [])
    vi.mocked(window.api.listWorkspaceDirectory).mockClear()
    act(() => ref.current!.refresh({ oldRelativePath: 'assets', newRelativePath: 'renamed' }))
    await screen.findByRole('button', { name: /image.png/ })
    expect(screen.getByRole('textbox')).toHaveValue('image')
    expect(vi.mocked(window.api.listWorkspaceDirectory).mock.calls.map(call => call[1])).toEqual(['', 'renamed'])
    expect(screen.getByRole('button', { name: /image.png/ })).toHaveAttribute('title', 'renamed/image.png')
  })

  it('ignores results from an unmounted workspace', async () => {
    let resolve!: (entries: WorkspaceDirectoryEntry[]) => void
    vi.mocked(window.api.listWorkspaceDirectory).mockReturnValueOnce(new Promise(done => { resolve = done }))
    const { unmount } = mount()
    unmount()
    mount()
    await screen.findByRole('button', { name: /README.md/ })
    await act(async () => resolve([file('old-workspace.txt')]))
    expect(screen.queryByRole('button', { name: /old-workspace.txt/ })).toBeNull()
  })
})
