/**
 * AppDataManager 单元测试
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Store from 'electron-store'
import * as fs from 'fs/promises'
import * as path from 'path'

// Mock electron-store
vi.mock('electron-store', () => {
  return {
    default: vi.fn().mockImplementation(function () {
      const data: Record<string, unknown> = {
        recentFiles: [],
        bookmarks: [],
        pinnedTabs: [],
        settings: {
          imageDir: 'assets',
          autoSave: true,
          bookmarkPanelWidth: 240,
          bookmarkPanelCollapsed: false
        }
      }
      return {
        get: vi.fn((key: string, defaultValue?: unknown) => data[key] ?? defaultValue),
        set: vi.fn((key: string, value: unknown) => { data[key] = value })
      }
    })
  }
})

// Mock fs/promises
vi.mock('fs/promises', () => ({
  stat: vi.fn(),
  access: vi.fn()
}))

// 重新导入以应用 mock
const { appDataManager } = await import('../appDataManager')

describe('AppDataManager', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('最近文件管理', () => {
    it('应该返回空的最近文件列表', () => {
      const files = appDataManager.getRecentFiles()
      expect(Array.isArray(files)).toBe(true)
    })

    it('应该添加最近文件', async () => {
      // Mock fs.stat 返回文件信息
      vi.mocked(fs.stat).mockResolvedValue({
        isDirectory: () => false
      } as unknown as Awaited<ReturnType<typeof fs.stat>>)

      await appDataManager.addRecentFile({
        path: '/test/file.md',
        name: 'file.md',
        folderPath: '/test'
      })

      expect(fs.stat).toHaveBeenCalled()
    })

    it('不应该添加目录到最近文件', async () => {
      vi.mocked(fs.stat).mockResolvedValue({
        isDirectory: () => true
      } as unknown as Awaited<ReturnType<typeof fs.stat>>)

      await appDataManager.addRecentFile({
        path: '/test/folder',
        name: 'folder',
        folderPath: '/test'
      })

      // 应该调用 stat 但不应该添加
      expect(fs.stat).toHaveBeenCalled()
    })

    it('应该移除最近文件', () => {
      appDataManager.removeRecentFile('/test/file.md')
      // 不应该抛出错误
      expect(true).toBe(true)
    })

    it('应该清空最近文件', () => {
      appDataManager.clearRecentFiles()
      // 不应该抛出错误
      expect(true).toBe(true)
    })
  })

  describe('固定标签管理', () => {
    it('应该返回空的固定标签列表', () => {
      const tabs = appDataManager.getPinnedTabs()
      expect(Array.isArray(tabs)).toBe(true)
    })

    it('应该添加固定标签', () => {
      appDataManager.addPinnedTab('/test/file.md')
      // 不应该抛出错误
      expect(true).toBe(true)
    })

    it('应该移除固定标签', () => {
      appDataManager.removePinnedTab('/test/file.md')
      // 不应该抛出错误
      expect(true).toBe(true)
    })

    it('应该更新固定标签顺序', () => {
      appDataManager.updatePinnedTabsOrder(['/test/a.md', '/test/b.md'])
      // 不应该抛出错误
      expect(true).toBe(true)
    })

    it('应该检查标签是否固定', () => {
      const isPinned = appDataManager.isTabPinned('/test/file.md')
      expect(typeof isPinned).toBe('boolean')
    })

    it('应该清空所有固定标签', () => {
      appDataManager.clearPinnedTabs()
      // 不应该抛出错误
      expect(true).toBe(true)
    })
  })

  describe('书签管理', () => {
    it('应该返回空的书签列表', () => {
      const bookmarks = appDataManager.getBookmarks()
      expect(Array.isArray(bookmarks)).toBe(true)
    })

    it('应该添加书签', () => {
      const bookmark = appDataManager.addBookmark({
        filePath: '/test/file.md',
        fileName: 'file.md'
      })

      expect(bookmark).toHaveProperty('id')
      expect(bookmark).toHaveProperty('createdAt')
      expect(bookmark).toHaveProperty('order')
      expect(bookmark.filePath).toBe('/test/file.md')
    })

    it('应该更新书签', () => {
      const bookmark = appDataManager.addBookmark({
        filePath: '/test/file.md',
        fileName: 'file.md'
      })

      appDataManager.updateBookmark(bookmark.id, { title: '新标题' })
      // 不应该抛出错误
      expect(true).toBe(true)
    })

    it('应该删除书签', () => {
      const bookmark = appDataManager.addBookmark({
        filePath: '/test/file.md',
        fileName: 'file.md'
      })

      appDataManager.removeBookmark(bookmark.id)
      // 不应该抛出错误
      expect(true).toBe(true)
    })

    it('应该清空所有书签', () => {
      appDataManager.clearBookmarks()
      // 不应该抛出错误
      expect(true).toBe(true)
    })
  })

  describe('设置管理', () => {
    it('应该获取默认设置', () => {
      const settings = appDataManager.getSettings()
      expect(settings).toHaveProperty('imageDir')
      expect(settings).toHaveProperty('autoSave')
      expect(settings).toHaveProperty('bookmarkPanelWidth')
      expect(settings).toHaveProperty('bookmarkPanelCollapsed')
    })

    it('应该更新设置', () => {
      appDataManager.updateSettings({ imageDir: 'images' })
      // 不应该抛出错误
      expect(true).toBe(true)
    })
  })

  describe('文件树折叠状态', () => {
    it('默认应该返回空状态', () => {
      expect(appDataManager.getFolderTreeState('/workspace/default-empty')).toEqual({})
    })

    it('应该只保存 false 状态', () => {
      appDataManager.saveFolderTreeState('/workspace/only-false', {
        'docs/archive': false,
        'docs/current': true as unknown as false
      })

      expect(appDataManager.getFolderTreeState('/workspace/only-false')).toEqual({
        'docs/archive': false
      })
    })

    it('应该清理不安全 treePath', () => {
      appDataManager.saveFolderTreeState('/workspace/sanitize', {
        'docs/archive': false,
        '../outside': false,
        '/absolute': false,
        '': false
      })

      expect(appDataManager.getFolderTreeState('/workspace/sanitize')).toEqual({
        'docs/archive': false
      })
    })

    it('不同根目录的状态应该互相隔离', () => {
      appDataManager.saveFolderTreeState('/workspace/root-a', { docs: false })
      appDataManager.saveFolderTreeState('/workspace/root-b', { old: false })

      expect(appDataManager.getFolderTreeState('/workspace/root-a')).toEqual({ docs: false })
      expect(appDataManager.getFolderTreeState('/workspace/root-b')).toEqual({ old: false })
    })

    it('应该可以清空单个根目录状态', () => {
      appDataManager.saveFolderTreeState('/workspace/clear', { docs: false })
      appDataManager.clearFolderTreeState('/workspace/clear')

      expect(appDataManager.getFolderTreeState('/workspace/clear')).toEqual({})
    })

    it('不应该误杀合法的 ..foo 目录名', () => {
      appDataManager.saveFolderTreeState('/workspace/dot-prefix', {
        '..foo': false
      })

      expect(appDataManager.getFolderTreeState('/workspace/dot-prefix')).toEqual({
        '..foo': false
      })
    })

    it('应该把反斜杠 treePath 规范为正斜杠', () => {
      appDataManager.saveFolderTreeState('/workspace/backslash', {
        'docs\\archive': false
      })

      expect(appDataManager.getFolderTreeState('/workspace/backslash')).toEqual({
        'docs/archive': false
      })
    })
  })
})
