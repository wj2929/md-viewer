import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ShortcutsHelpDialog } from '../../src/components/ShortcutsHelpDialog'

describe('ShortcutsHelpDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(window as any).api = {
      ...window.api,
      platform: 'darwin',
      openExternal: vi.fn().mockResolvedValue({ success: true }),
    }
  })

  it('提供使用手册入口', async () => {
    render(<ShortcutsHelpDialog isOpen onClose={vi.fn()} />)

    const manualButton = screen.getByRole('button', { name: /打开使用手册/ })
    await userEvent.click(manualButton)

    expect(window.api.openExternal).toHaveBeenCalledWith(expect.stringContaining('docs/user-manual.md'))
  })
})
