/**
 * AppDataManager.folderTabSession 单元测试（v2.8.0 按文件夹归档 tab 会话）
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'fs/promises'
import * as path from 'path'

// Mock electron-store（每个测试文件独立的模块实例）
vi.mock('electron-store', () => {
  return {
    default: vi.fn().mockImplementation(function () {
      const data: Record<string, unknown> = { folderTabSessions: {} }
      return {
        get: vi.fn((key: string, defaultValue?: unknown) => data[key] ?? defaultValue),
        set: vi.fn((key: string, value: unknown) => { data[key] = value })
      }
    })
  }
})

// Mock fs/promises：默认所有路径视为存在的文件
vi.mock('fs/promises', () => ({
  stat: vi.fn(),
  access: vi.fn()
}))

const { appDataManager } = await import('../appDataManager')

// 让 fs.stat 对指定的失效路径抛错，其余返回文件
function mockStatExcept(invalidPaths: string[] = []): void {
  const invalid = new Set(invalidPaths.map(p => path.resolve(p)))
  vi.mocked(fs.stat).mockImplementation(async (p: any) => {
    if (invalid.has(path.resolve(String(p)))) throw new Error('ENOENT')
    return { isFile: () => true, isDirectory: () => false } as unknown as Awaited<ReturnType<typeof fs.stat>>
  })
}

describe('AppDataManager.folderTabSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStatExcept()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('保存后按顺序读回绝对路径，并保留 active 与 isPinned', async () => {
    const root = path.resolve('/ws/session-roundtrip')
    appDataManager.saveFolderTabSession(
      root,
      [
        { filePath: path.join(root, 'a.md'), isPinned: true },
        { filePath: path.join(root, 'docs', 'b.md') }
      ],
      path.join(root, 'docs', 'b.md')
    )

    const session = await appDataManager.getFolderTabSession(root)
    expect(session.tabs.map(t => t.path)).toEqual([
      path.join(root, 'a.md'),
      path.join(root, 'docs', 'b.md')
    ])
    expect(session.tabs[0].isPinned).toBe(true)
    expect(session.activePath).toBe(path.join(root, 'docs', 'b.md'))
  })

  it('保存并校验版本化分屏布局', async () => {
    const root = '/ws/session-split'
    appDataManager.saveFolderTabSession(
      root,
      [
        { filePath: path.join(root, 'a.md') },
        { filePath: path.join(root, 'b.md') },
      ],
      path.join(root, 'b.md'),
      {
        version: 1,
        root: {
          type: 'split',
          direction: 'horizontal',
          ratio: 0.6,
          first: { type: 'leaf', relativePath: 'a.md', viewState: { scrollRatio: 0.2 } },
          second: { type: 'leaf', relativePath: 'b.md', viewState: { scrollRatio: 0.8 } },
        },
        activeLeafPath: [1],
      },
    )

    const session = await appDataManager.getFolderTabSession(root)
    expect(session.splitLayout).toEqual({
      version: 1,
      root: {
        type: 'split',
        direction: 'horizontal',
        ratio: 0.6,
        first: { type: 'leaf', relativePath: 'a.md', viewState: { scrollRatio: 0.2 } },
        second: { type: 'leaf', relativePath: 'b.md', viewState: { scrollRatio: 0.8 } },
      },
      activeLeafPath: [1],
    })
  })

  it('布局引用失效文件时收缩树且清除失效 active leaf', async () => {
    const root = '/ws/session-split-stale'
    const gone = path.join(root, 'gone.md')
    appDataManager.saveFolderTabSession(
      root,
      [{ filePath: path.join(root, 'live.md') }, { filePath: gone }],
      gone,
      {
        version: 1,
        root: {
          type: 'split',
          direction: 'vertical',
          ratio: 0.5,
          first: { type: 'leaf', relativePath: 'live.md' },
          second: { type: 'leaf', relativePath: 'gone.md' },
        },
        activeLeafPath: [1],
      },
    )
    mockStatExcept([gone])

    const session = await appDataManager.getFolderTabSession(root)
    expect(session.splitLayout).toEqual({
      version: 1,
      root: { type: 'leaf', relativePath: 'live.md' },
      activeLeafPath: null,
    })
  })

  it('折叠非活动失效分支后重映射 active leaf 到新结构路径', async () => {
    const root = '/ws/session-split-remap'
    const gone = path.join(root, 'gone.md')
    appDataManager.saveFolderTabSession(
      root,
      [{ filePath: gone }, { filePath: path.join(root, 'live.md') }],
      path.join(root, 'live.md'),
      {
        version: 1,
        root: {
          type: 'split',
          direction: 'horizontal',
          ratio: 0.5,
          first: { type: 'leaf', relativePath: 'gone.md' },
          second: { type: 'leaf', relativePath: 'live.md' },
        },
        activeLeafPath: [1],
      },
    )
    mockStatExcept([gone])

    const session = await appDataManager.getFolderTabSession(root)
    expect(session.splitLayout).toEqual({
      version: 1,
      root: { type: 'leaf', relativePath: 'live.md' },
      activeLeafPath: [],
    })
  })

  it('未知或越权分屏布局不会破坏 tab 会话', async () => {
    const root = '/ws/session-split-invalid'
    appDataManager.saveFolderTabSession(
      root,
      [{ filePath: path.join(root, 'a.md') }],
      null,
      {
        version: 1,
        root: { type: 'leaf', relativePath: '../outside.md' },
        activeLeafPath: [],
      },
    )

    const session = await appDataManager.getFolderTabSession(root)
    expect(session.tabs).toHaveLength(1)
    expect(session.splitLayout).toBeUndefined()
  })

  it('拒绝归档文件夹外的路径（防遍历）', async () => {
    const root = path.resolve('/ws/session-traversal')
    appDataManager.saveFolderTabSession(
      root,
      [
        { filePath: path.join(root, 'inside.md') },
        { filePath: '/etc/outside.md' },
        { filePath: path.join(root, '..', 'sibling.md') }
      ],
      null
    )

    const session = await appDataManager.getFolderTabSession(root)
    expect(session.tabs.map(t => t.path)).toEqual([path.join(root, 'inside.md')])
  })

  it('读取时剔除已失效（不存在）的条目', async () => {
    const root = path.resolve('/ws/session-stale')
    const gone = path.join(root, 'gone.md')
    appDataManager.saveFolderTabSession(
      root,
      [{ filePath: path.join(root, 'live.md') }, { filePath: gone }],
      null
    )
    mockStatExcept([gone])

    const session = await appDataManager.getFolderTabSession(root)
    expect(session.tabs.map(t => t.path)).toEqual([path.join(root, 'live.md')])
  })

  it('active 文件失效时回退到首个有效 tab', async () => {
    const root = path.resolve('/ws/session-active-fallback')
    const activeGone = path.join(root, 'active.md')
    appDataManager.saveFolderTabSession(
      root,
      [{ filePath: path.join(root, 'first.md') }, { filePath: activeGone }],
      activeGone
    )
    mockStatExcept([activeGone])

    const session = await appDataManager.getFolderTabSession(root)
    expect(session.activePath).toBe(path.join(root, 'first.md'))
  })

  it('每个文件夹最多归档 100 个 tab', async () => {
    const root = path.resolve('/ws/session-cap')
    const tabs = Array.from({ length: 150 }, (_, i) => ({ filePath: path.join(root, `f${i}.md`) }))
    appDataManager.saveFolderTabSession(root, tabs, null)

    const session = await appDataManager.getFolderTabSession(root)
    expect(session.tabs).toHaveLength(100)
    expect(session.tabs[0].path).toBe(path.join(root, 'f0.md'))
    expect(session.tabs[99].path).toBe(path.join(root, 'f99.md'))
  })

  it('空 tab 列表清除该文件夹会话', async () => {
    const root = '/ws/session-clear-empty'
    appDataManager.saveFolderTabSession(root, [{ filePath: path.join(root, 'a.md') }], null)
    expect((await appDataManager.getFolderTabSession(root)).tabs).toHaveLength(1)

    appDataManager.saveFolderTabSession(root, [], null)
    expect((await appDataManager.getFolderTabSession(root)).tabs).toHaveLength(0)
  })

  it('clearFolderTabSession 可显式清除单个文件夹', async () => {
    const root = '/ws/session-explicit-clear'
    appDataManager.saveFolderTabSession(root, [{ filePath: path.join(root, 'a.md') }], null)
    appDataManager.clearFolderTabSession(root)
    expect((await appDataManager.getFolderTabSession(root)).tabs).toHaveLength(0)
  })

  it('超过 50 个文件夹时按 updatedAt LRU 淘汰最旧的', async () => {
    // 起始时钟高于真实 Date.now，确保本用例的 60 个文件夹比其它用例遗留的记录都新
    let clock = 20_000_000_000_000
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => (clock += 1_000))

    // 依次归档 60 个文件夹，clock 递增 → 越晚的越新
    for (let i = 0; i < 60; i++) {
      const root = `/ws/lru/folder-${i}`
      appDataManager.saveFolderTabSession(root, [{ filePath: path.join(root, 'a.md') }], null)
    }

    // 最旧的 10 个（0..9）应被淘汰
    expect((await appDataManager.getFolderTabSession('/ws/lru/folder-0')).tabs).toHaveLength(0)
    expect((await appDataManager.getFolderTabSession('/ws/lru/folder-9')).tabs).toHaveLength(0)
    // 较新的应保留
    expect((await appDataManager.getFolderTabSession('/ws/lru/folder-10')).tabs).toHaveLength(1)
    expect((await appDataManager.getFolderTabSession('/ws/lru/folder-59')).tabs).toHaveLength(1)

    nowSpy.mockRestore()
  })
})
