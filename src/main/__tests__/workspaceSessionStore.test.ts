import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron-store', () => ({
  default: vi.fn().mockImplementation(function () {
    const data: Record<string, unknown> = {
      desktopSession: null,
      windowLifecycleV1Migrated: false,
    }
    return {
      get: vi.fn((key: string, defaultValue?: unknown) => data[key] ?? defaultValue),
      set: vi.fn((key: string, value: unknown) => { data[key] = value }),
    }
  }),
}))

const {
  WorkspaceSessionStore,
  orderDesktopSessionWindows,
} = await import('../workspaceSessionStore')

type Session = import('../workspaceSessionStore').DesktopSessionV1

function snapshot(id: string): Session['windows'][number] {
  return {
    id,
    bounds: { x: 0, y: 0, width: 1200, height: 800 },
    isMaximized: false,
    alwaysOnTop: false,
    activeWorkspaceId: null,
    workspaces: [],
  }
}

describe('WorkspaceSessionStore desktop MRU', () => {
  let store: InstanceType<typeof WorkspaceSessionStore>

  beforeEach(() => {
    store = new WorkspaceSessionStore()
  })

  it('优先返回最近活跃窗口且不改变其余快照顺序', () => {
    const session: Session = {
      version: 1,
      windows: [snapshot('a'), snapshot('b'), snapshot('c')],
      lastActiveWindowId: 'b',
    }

    expect(orderDesktopSessionWindows(session).map((window) => window.id)).toEqual(['b', 'a', 'c'])
    expect(session.windows.map((window) => window.id)).toEqual(['a', 'b', 'c'])
  })

  it('旧会话或失效 MRU 回退到最后一个窗口', () => {
    const oldSession: Session = { version: 1, windows: [snapshot('a'), snapshot('b')] }
    const staleSession: Session = { ...oldSession, lastActiveWindowId: 'missing' }

    expect(orderDesktopSessionWindows(oldSession).map((window) => window.id)).toEqual(['b', 'a'])
    expect(orderDesktopSessionWindows(staleSession).map((window) => window.id)).toEqual(['b', 'a'])
  })

  it('聚焦已绑定窗口时记录 MRU 且不丢其他快照', () => {
    store.save({ version: 1, windows: [snapshot('a'), snapshot('b'), snapshot('c')] })
    store.bindRestoredWindow(42, 'b')

    store.markWindowActive(42)

    expect(store.load()?.lastActiveWindowId).toBe('b')
    expect(store.load()?.windows.map((window) => window.id)).toEqual(['a', 'b', 'c'])
  })

  it('删除最近活跃窗口时清理失效 MRU', () => {
    store.save({
      version: 1,
      windows: [snapshot('a'), snapshot('b')],
      lastActiveWindowId: 'b',
    })
    store.bindRestoredWindow(42, 'b')

    store.forgetWindow(42)

    expect(store.load()?.windows.map((window) => window.id)).toEqual(['a'])
    expect(store.load()?.lastActiveWindowId).toBeUndefined()
  })
})
