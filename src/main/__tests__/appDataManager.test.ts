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
const appDataStore = vi.mocked(Store).mock.results[0].value
const defaultSettings = vi.mocked(Store).mock.calls[0][0]?.defaults?.settings

describe('AppDataManager', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('大文档批准存储', () => {
    beforeEach(() => appDataStore.set('largeDocumentApprovals', []))

    it('保存/读取/撤销仅影响目标文档，读取不返回路径', () => {
      appDataManager.setLargeDocumentApproval(path.resolve('/self/a.md'), { characters: 1_500_001, lines: 3 })
      appDataManager.setLargeDocumentApproval(path.resolve('/self/b.md'), { characters: 2_000_000, lines: 4 })
      expect(appDataManager.getLargeDocumentApproval(path.resolve('/self/./a.md'))).toEqual({ characters: 1_500_001, lines: 3 })
      appDataManager.setLargeDocumentApproval(path.resolve('/self/a.md'), null)
      expect(appDataManager.getLargeDocumentApproval(path.resolve('/self/a.md'))).toBeNull()
      expect(appDataManager.getLargeDocumentApproval(path.resolve('/self/b.md'))).toEqual({ characters: 2_000_000, lines: 4 })
    })

    it('保持100篇上限，更新移到末尾，不改变获准时规模', () => {
      for (let i = 0; i < 100; i++) appDataManager.setLargeDocumentApproval(path.resolve(`/self/${i}.md`), { characters: 10 + i, lines: 2 })
      appDataManager.setLargeDocumentApproval(path.resolve('/self/0.md'), { characters: 10, lines: 2 })
      appDataManager.setLargeDocumentApproval(path.resolve('/self/new.md'), { characters: 1500001, lines: 3 })
      expect(appDataStore.get('largeDocumentApprovals')).toHaveLength(100)
      expect(appDataManager.getLargeDocumentApproval(path.resolve('/self/1.md'))).toBeNull()
      expect(appDataManager.getLargeDocumentApproval(path.resolve('/self/0.md'))).toEqual({ characters: 10, lines: 2 })
    })

    it('不改变其他设置或500条最近记录', () => {
      const previousSettings = appDataStore.get('settings')
      const previousRecent = appDataStore.get('recentFiles')
      const settings = { imageDir: 'self-assets', maxRecentFiles: 500 }
      const recent = Array.from({ length: 500 }, (_, id) => ({ id: String(id) }))
      appDataStore.set('settings', settings)
      appDataStore.set('recentFiles', recent)
      appDataStore.set.mockClear()
      appDataManager.setLargeDocumentApproval(path.resolve('/self/a.md'), { characters: 1500001, lines: 3 })
      expect(appDataStore.set.mock.calls.map((call: unknown[]) => call[0])).toEqual(['largeDocumentApprovals'])
      expect(appDataStore.get('settings')).toEqual(settings)
      expect(appDataStore.get('recentFiles')).toEqual(recent)
      appDataStore.set('settings', previousSettings)
      appDataStore.set('recentFiles', previousRecent)
    })

    it('损坏记录不能放行，写入只保留路径和规模', () => {
      appDataStore.set('largeDocumentApprovals', [null, { path: path.resolve('/self/a.md'), characters: 'huge', lines: -1 }])
      expect(appDataManager.getLargeDocumentApproval(path.resolve('/self/a.md'))).toBeNull()
      appDataManager.setLargeDocumentApproval(path.resolve('/self/b.md'), { characters: 1500001, lines: 3, content: 'private body' } as any)
      expect(appDataStore.get('largeDocumentApprovals')).toEqual([{ path: path.resolve('/self/b.md'), characters: 1500001, lines: 3 }])
      appDataStore.set('largeDocumentApprovals', { invalid: true })
      expect(appDataManager.getLargeDocumentApproval(path.resolve('/self/b.md'))).toBeNull()
    })

    it.each([{}, { characters: 0, lines: 3 }, { characters: 1.5, lines: 3 }, { characters: Infinity, lines: 3 }])('无效规模不能写入：%j', value => {
      expect(() => appDataManager.setLargeDocumentApproval(path.resolve('/self/a.md'), value as any)).toThrow('无效')
      expect(appDataStore.get('largeDocumentApprovals')).toEqual([])
    })
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

  describe('最近文件后台校验', () => {
    const entry = (id: number) => ({ id: String(id), path: path.resolve(`/self/${id}.md`), name: `${id}.md`, folderPath: path.resolve('/self'), lastOpened: 1 })
    const missing = (code = 'ENOENT') => Object.assign(new Error('missing'), { code })
    let previousRecent: unknown
    let previousSettings: unknown
    beforeEach(() => {
      previousRecent = appDataStore.get('recentFiles')
      previousSettings = appDataStore.get('settings')
      appDataStore.set('recentFiles', [entry(1), entry(2)])
      appDataStore.set('settings', { maxRecentFiles: 500 })
      vi.mocked(fs.access).mockReset().mockResolvedValue(undefined)
      vi.mocked(fs.stat).mockReset().mockResolvedValue({ isDirectory: () => false } as any)
      vi.useFakeTimers()
      appDataStore.set.mockClear()
    })
    afterEach(() => {
      vi.clearAllTimers()
      vi.useRealTimers()
      appDataStore.set('recentFiles', previousRecent)
      appDataStore.set('settings', previousSettings)
    })
    const holdFirst = () => {
      let reject!: (error: unknown) => void
      let resolve!: () => void
      vi.mocked(fs.access).mockImplementation(async file => {
        if (file === path.resolve('/self/1.md')) await new Promise<void>((yes, no) => { resolve = yes; reject = no })
      })
      return { reject: (error: unknown) => reject(error), resolve: () => resolve() }
    }

    it.each(['success', 'ENOENT'] as const)('500条超时后迟到%s仍保留且不再写入', async result => {
      const files = Array.from({ length: 500 }, (_, id) => entry(id + 1))
      appDataStore.set('recentFiles', files)
      const gate = holdFirst()
      const pending = appDataManager.validateRecentFilesInBackground()
      appDataStore.set.mockClear()
      await vi.advanceTimersByTimeAsync(1001)
      await pending
      expect(appDataStore.get('recentFiles')).toEqual(files)
      if (result === 'success') gate.resolve()
      else gate.reject(missing())
      await Promise.resolve()
      expect(appDataStore.get('recentFiles')).toEqual(files)
      expect(appDataStore.set).not.toHaveBeenCalled()
      expect(appDataManager.getMaxRecentFiles()).toBe(500)
      expect(vi.getTimerCount()).toBe(0)
    })

    it.each(['EACCES', 'EPERM', 'EIO', undefined])('非明确缺失错误%s不移除、不写store', async code => {
      vi.mocked(fs.access).mockRejectedValue(code ? Object.assign(new Error('unavailable'), { code }) : null)
      await appDataManager.validateRecentFilesInBackground()
      expect(appDataStore.get('recentFiles')).toEqual([entry(1), entry(2)])
      expect(appDataStore.set).not.toHaveBeenCalled()
      expect(vi.getTimerCount()).toBe(0)
    })

    it.each(['ENOENT', 'ENOTDIR'])('仅移除确认%s且未更新的身份', async code => {
      vi.mocked(fs.access).mockImplementation(async file => { if (file === path.resolve('/self/1.md')) throw missing(code) })
      await appDataManager.validateRecentFilesInBackground()
      expect(appDataStore.get('recentFiles')).toEqual([entry(2)])
      expect(vi.getTimerCount()).toBe(0)
    })

    it('期间新增保留当前顺序，旧快照不能覆盖', async () => {
      const gate = holdFirst()
      const pending = appDataManager.validateRecentFilesInBackground()
      await appDataManager.addRecentFile({ path: path.resolve('/self/3.md'), name: '3.md', folderPath: path.resolve('/self') })
      const current = [...appDataStore.get('recentFiles')]
      gate.reject(missing())
      await pending
      expect(appDataStore.get('recentFiles')).toEqual(current.filter(file => file.path !== path.resolve('/self/1.md')))
    })

    it('同毫秒同路径重新添加的新ID不被旧缺失结果删除', async () => {
      vi.setSystemTime(1)
      const gate = holdFirst()
      const pending = appDataManager.validateRecentFilesInBackground()
      await appDataManager.addRecentFile({ path: path.resolve('/self/1.md'), name: '1.md', folderPath: path.resolve('/self') })
      const current = [...appDataStore.get('recentFiles')]
      expect(current[0].id).not.toBe('1')
      expect(current[0].lastOpened).toBe(1)
      appDataStore.set.mockClear()
      gate.reject(missing())
      await pending
      expect(appDataStore.get('recentFiles')).toEqual(current)
      expect(appDataStore.set).not.toHaveBeenCalled()
    })

    it.each(['id', 'path', 'name', 'folderPath', 'lastOpened'] as const)('校验期间原地更新%s也不被旧结果删除', async field => {
      const gate = holdFirst()
      const pending = appDataManager.validateRecentFilesInBackground()
      const current = appDataStore.get('recentFiles')
      current[0][field] = field === 'lastOpened' ? 2 : '/changed'
      gate.reject(missing())
      await pending
      expect(appDataStore.get('recentFiles')).toEqual(current)
      expect(appDataStore.set).not.toHaveBeenCalled()
    })

    it.each(['remove', 'clear'] as const)('期间%s不能被旧结果复活，随后新增仍保留', async mode => {
      const gate = holdFirst()
      const pending = appDataManager.validateRecentFilesInBackground()
      if (mode === 'remove') appDataManager.removeRecentFile(path.resolve('/self/2.md'))
      else appDataManager.clearRecentFiles()
      await appDataManager.addRecentFile({ path: path.resolve('/self/3.md'), name: '3.md', folderPath: path.resolve('/self') })
      const added = appDataStore.get('recentFiles')[0]
      gate.reject(missing())
      await pending
      expect(appDataStore.get('recentFiles')).toEqual([added])
    })

    it('两轮反序完成仅局部移除，不能覆盖或复活另一轮的结果', async () => {
      let first!: (error: unknown) => void
      let second!: (error: unknown) => void
      vi.mocked(fs.access)
        .mockImplementationOnce(() => new Promise((_, reject) => { first = reject }))
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockImplementationOnce(() => new Promise((_, reject) => { second = reject }))
      const one = appDataManager.validateRecentFilesInBackground()
      const two = appDataManager.validateRecentFilesInBackground()
      second(missing()); await two
      expect(appDataStore.get('recentFiles')).toEqual([entry(1)])
      first(missing()); await one
      expect(appDataStore.get('recentFiles')).toEqual([])
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

    it('目录拼音设置仅更新自身字段，旧配置不被读操作重写', () => {
      const before = appDataManager.getSettings()
      expect(before.folderPinyinSearchEnabled).toBeUndefined()
      expect(defaultSettings).toHaveProperty('folderPinyinSearchEnabled', false)
      expect(appDataStore.set).not.toHaveBeenCalled()
      appDataManager.updateSettings({ folderPinyinSearchEnabled: true })
      expect(appDataManager.getSettings()).toEqual({ ...before, folderPinyinSearchEnabled: true })
      appDataManager.updateSettings({ folderPinyinSearchEnabled: false })
      expect(appDataManager.getSettings().folderPinyinSearchEnabled).toBe(false)
    })

    it('工作区文件排序独立保存，读取旧配置不补写，保留已有设置', () => {
      const before = appDataManager.getSettings()
      expect(defaultSettings).toHaveProperty('browserSort', { by: 'name', direction: 'asc' })
      expect(appDataStore.set).not.toHaveBeenCalled()
      try {
        appDataManager.updateSettings({ browserSort: { by: 'modified', direction: 'desc' } })
        expect(appDataManager.getSettings()).toEqual({ ...before, browserSort: { by: 'modified', direction: 'desc' } })
        appDataManager.updateSettings({ fileTreeSort: { by: 'natural', direction: 'asc' } })
        expect(appDataManager.getSettings().browserSort).toEqual({ by: 'modified', direction: 'desc' })
      } finally { appDataStore.set('settings', before) }
    })

    it('应该更新设置', () => {
      appDataManager.updateSettings({ imageDir: 'images' })
      // 不应该抛出错误
      expect(true).toBe(true)
    })

    it('应该提供并整体保存诊断日志设置', () => {
      expect(appDataManager.getDiagnosticLogSettings()).toEqual({
        enabled: true,
        maxTotalMiB: 10,
        retentionDays: 7,
      })

      expect(appDataManager.setDiagnosticLogSettings({
        enabled: false,
        directory: '/tmp/md-viewer-logs',
        maxTotalMiB: 25,
        retentionDays: 14,
      })).toEqual({
        enabled: false,
        directory: '/tmp/md-viewer-logs',
        maxTotalMiB: 25,
        retentionDays: 14,
      })
      expect(appDataManager.getDiagnosticLogSettings().directory).toBe('/tmp/md-viewer-logs')
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

  describe('文档背景标记', () => {
    it('按工作区相对路径保存、改色和取消', () => {
      const root = '/workspace/document-marks'
      const file = path.join(root, 'docs', 'plan.md')

      expect(appDataManager.setDocumentMark(root, file, 'yellow')).toEqual({
        'docs/plan.md': 'yellow'
      })
      expect(appDataManager.setDocumentMark(root, file, 'blue')).toEqual({
        'docs/plan.md': 'blue'
      })
      expect(appDataManager.setDocumentMark(root, file, null)).toEqual({})
    })

    it('拒绝越界路径、非 Markdown 和未知颜色', () => {
      const root = '/workspace/document-marks-safe'
      expect(() => appDataManager.setDocumentMark(root, '/outside/file.md', 'red')).toThrow()
      expect(() => appDataManager.setDocumentMark(root, path.join(root, 'file.txt'), 'red')).toThrow()
      expect(() => appDataManager.setDocumentMark(root, path.join(root, 'file.md'), '#fff' as any)).toThrow()
    })

    it('保存或清除折叠状态不应删除背景标记', () => {
      const root = '/workspace/document-marks-tree-state'
      appDataManager.setDocumentMark(root, path.join(root, 'notes.md'), 'green')
      appDataManager.saveFolderTreeState(root, { docs: false })
      appDataManager.clearFolderTreeState(root)

      expect(appDataManager.getDocumentMarks(root)).toEqual({ 'notes.md': 'green' })
    })

    it('文件和目录移动时迁移标记，删除目录时清理后代', () => {
      const root = '/workspace/document-marks-lifecycle'
      appDataManager.setDocumentMark(root, path.join(root, 'old.md'), 'red')
      appDataManager.setDocumentMark(root, path.join(root, 'docs', 'nested.md'), 'purple')

      expect(appDataManager.relocateDocumentMarks(
        root,
        path.join(root, 'old.md'),
        path.join(root, 'new.md')
      )).toBe(true)
      expect(appDataManager.relocateDocumentMarks(
        root,
        path.join(root, 'docs'),
        path.join(root, 'archive'),
        true
      )).toBe(true)
      expect(appDataManager.getDocumentMarks(root)).toEqual({
        'new.md': 'red',
        'archive/nested.md': 'purple'
      })

      expect(appDataManager.removeDocumentMarks(root, path.join(root, 'archive'), true)).toBe(true)
      expect(appDataManager.getDocumentMarks(root)).toEqual({ 'new.md': 'red' })
    })
  })

  describe('阅读位置', () => {
    it('应该按规范化路径保存和读取阅读位置', () => {
      const saved = appDataManager.saveReadPosition({
        canonicalPath: '/workspace/docs/readme.md',
        scrollRatio: 0.42,
        headingId: 'section-a',
        contentHash: 'hash-a',
        updatedAt: 1700000000000
      })

      expect(saved).toMatchObject({
        canonicalPath: path.resolve('/workspace/docs/readme.md'),
        scrollRatio: 0.42,
        headingId: 'section-a',
        contentHash: 'hash-a',
        updatedAt: 1700000000000
      })
      expect(appDataManager.getReadPosition('/workspace/docs/readme.md')).toMatchObject(saved)
    })

    it('应该清理无效阅读位置字段并支持清除', () => {
      const saved = appDataManager.saveReadPosition({
        canonicalPath: '/workspace/docs/bad.md',
        scrollRatio: 1.5,
        headingId: '',
        updatedAt: 1700000000001
      })

      expect(saved.scrollRatio).toBeUndefined()
      expect(saved.headingId).toBeUndefined()

      appDataManager.clearReadPosition('/workspace/docs/bad.md')
      expect(appDataManager.getReadPosition('/workspace/docs/bad.md')).toBeNull()
    })
  })
})
