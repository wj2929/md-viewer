import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom'
import { FolderHistoryDropdown } from '../../src/components/FolderHistoryDropdown'
import { MoveToDialog } from '../../src/components/MoveToDialog'
import { useFolderSearchSettingsStore as store } from '../../src/stores/folderSearchSettingsStore'

describe('同窗口目录搜索偏好', () => {
  it('两入口共享选择，保存中均禁用，普通搜索仍可使用', async () => {
    let finish!: () => void
    const saving = new Promise<void>(resolve => { finish = resolve })
    window.api = {
      ...window.api,
      getFolderHistory: vi.fn().mockResolvedValue([{ id: 'h', name: '研发中心', path: '/fixture/root', lastOpened: 1 }]),
      getAppSettings: vi.fn().mockResolvedValue({}),
      updateAppSettings: vi.fn().mockReturnValue(saving),
    }
    store.setState({ hydration: 'idle', enabled: false, pending: null, saving: false, hasLoaded: false, error: null, revision: 0 })
    render(<><FolderHistoryDropdown onSelectFolder={vi.fn()} onOpenFolder={vi.fn()} /><MoveToDialog isOpen sources={['/fixture/note.md']} onClose={vi.fn()} /></>)
    await userEvent.click(screen.getByLabelText('最近打开的文件夹'))
    await waitFor(() => expect(screen.getAllByRole('checkbox', { name: '拼音搜索' })).toHaveLength(2))
    const [first, second] = screen.getAllByRole('checkbox', { name: '拼音搜索' })
    await waitFor(() => expect(first).not.toBeDisabled())
    await userEvent.click(first)
    expect(first).toBeDisabled()
    expect(second).toBeDisabled()
    expect(first).toBeChecked()
    expect(second).toBeChecked()
    expect(screen.getByLabelText('搜索最近文件夹')).not.toBeDisabled()
    expect(screen.getByLabelText('搜索移动目标目录')).not.toBeDisabled()
    finish()
    await waitFor(() => expect(first).not.toBeDisabled())
    expect(second).not.toBeDisabled()
    expect(window.api.updateAppSettings).toHaveBeenCalledTimes(1)
    expect(store.getState().enabled).toBe(true)
  })
})
