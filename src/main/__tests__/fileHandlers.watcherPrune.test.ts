import { describe, expect, it, vi } from 'vitest'
import { hasIgnoredPathSegment } from '../ipc/fileHandlers'

// 导入 fileHandlers 会牵动 electron/chokidar，mock 掉即可（被测函数本身是纯路径判断）
vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  BrowserWindow: { fromWebContents: vi.fn(), getAllWindows: vi.fn(() => []) },
  dialog: {},
  shell: {},
}))

vi.mock('chokidar', () => ({
  default: { watch: vi.fn(() => ({ on: vi.fn().mockReturnThis(), add: vi.fn(), close: vi.fn(), getWatched: vi.fn(() => ({})) })) },
}))

describe('hasIgnoredPathSegment（watcher 递归剪枝）', () => {
  it.each([
    '/Users/me/proj/node_modules',
    '/Users/me/proj/node_modules/react/index.js',
    '/Users/me/proj/.git',
    '/Users/me/proj/.git/objects/ab',
    '/Users/me/proj/.venv/lib',
    '/Users/me/proj/venv/bin',
    '/Users/me/proj/dist/bundle.js',
    '/Users/me/proj/build/out',
    '/Users/me/proj/__pycache__/x.pyc',
    '/Users/me/proj/coverage/lcov.info',
    '/Users/me/proj/.vscode/settings.json',
    '/Users/me/proj/vendor/pkg',
    '/Users/me/proj/target/debug',
  ])('剪除应被忽略的目录段：%s', (p) => {
    expect(hasIgnoredPathSegment(p)).toBe(true)
  })

  it.each([
    '/Users/me/proj/docs/readme.md',
    '/Users/me/proj/src/main/index.ts',
    '/Users/me/SynologyDrive/工作/旅游/2026暑期/plan.md',
    '/Users/me/proj/notes.md',
  ])('放行正常路径：%s', (p) => {
    expect(hasIgnoredPathSegment(p)).toBe(false)
  })

  it('放行 . 与 ..（不误判为隐藏目录）', () => {
    expect(hasIgnoredPathSegment('/Users/me/proj/../proj/a.md')).toBe(false)
    expect(hasIgnoredPathSegment('./a.md')).toBe(false)
  })

  it('普通含点文件名不触发隐藏目录规则（仅路径段以 . 开头才算）', () => {
    // 段 "a.md" 以 a 开头，不以 . 开头，应放行
    expect(hasIgnoredPathSegment('/Users/me/proj/a.md')).toBe(false)
  })
})
