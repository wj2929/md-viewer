import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearClipboardState,
  getClipboardState,
  isClipboardSourceAuthorized,
  syncClipboardState
} from '../clipboardState'

describe('clipboardState', () => {
  const firstWindow = 1
  const secondWindow = 2

  beforeEach(() => {
    clearClipboardState(firstWindow)
    clearClipboardState(secondWindow)
  })

  it('按窗口隔离剪贴板状态', () => {
    syncClipboardState(firstWindow, ['/folders/A/file.md'], false)
    syncClipboardState(secondWindow, ['/folders/B/file.md'], true)

    expect(getClipboardState(firstWindow)).toEqual({
      files: ['/folders/A/file.md'],
      isCut: false,
      hasFiles: true
    })
    expect(getClipboardState(secondWindow)).toEqual({
      files: ['/folders/B/file.md'],
      isCut: true,
      hasFiles: true
    })
  })

  it('仅授权规范化后的精确复制源', () => {
    syncClipboardState(firstWindow, ['/folders/A/dir/../file.md'], false)

    expect(isClipboardSourceAuthorized(firstWindow, '/folders/A/file.md')).toBe(true)
    expect(isClipboardSourceAuthorized(firstWindow, '/folders/A/other.md')).toBe(false)
    expect(isClipboardSourceAuthorized(secondWindow, '/folders/A/file.md')).toBe(false)
  })

  it('清空后应撤销该窗口授权', () => {
    syncClipboardState(firstWindow, ['/folders/A/file.md'], false)
    clearClipboardState(firstWindow)

    expect(getClipboardState(firstWindow).hasFiles).toBe(false)
    expect(isClipboardSourceAuthorized(firstWindow, '/folders/A/file.md')).toBe(false)
  })
})
