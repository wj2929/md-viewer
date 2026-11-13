import { beforeEach, describe, expect, it, vi } from 'vitest'

const runtime = vi.hoisted(() => ({
  code: 0,
  app: { on: vi.fn(), quit: vi.fn(), exit: vi.fn(), whenReady: vi.fn<() => Promise<void>>() },
}))
vi.mock('electron', () => ({ app: runtime.app }))
vi.mock('../safeLog', () => ({ installEpipeHandler: vi.fn() }))
vi.mock('../cli/parserMode', () => ({ isHeadlessCliArgv: () => true }))
vi.mock('../cli/bootstrap', () => ({
  runCliOnStartup: async (_argv: string[], options: { exit: (code: number) => void }) => {
    options.exit(runtime.code)
    return { handled: true }
  },
}))

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  runtime.app.whenReady.mockResolvedValue(undefined)
})

describe('CLI entry exit', () => {
  it('成功命令完成输出后正常退出，不强制终止原生启动资源', async () => {
    runtime.code = 0
    await import('../index')
    await vi.waitFor(() => expect(runtime.app.quit).toHaveBeenCalledTimes(1))
    expect(runtime.app.exit).not.toHaveBeenCalled()
    expect(runtime.app.whenReady).not.toHaveBeenCalled()
  })

  it.each([1, 2, 5])('错误命令在ready之前不提前终止，屏障后保留退出码 %s', async code => {
    runtime.code = code
    let ready!: () => void
    runtime.app.whenReady.mockReturnValue(new Promise<void>(resolve => { ready = resolve }))
    await import('../index')
    await vi.waitFor(() => expect(runtime.app.whenReady).toHaveBeenCalledTimes(1))
    expect(runtime.app.exit).not.toHaveBeenCalled()
    expect(runtime.app.quit).not.toHaveBeenCalled()
    ready()
    await vi.waitFor(() => expect(runtime.app.exit).toHaveBeenCalledExactlyOnceWith(code))
  })

  it.each([1, 2, 5])('错误命令保留非零退出码 %s，不被 app.quit 重置为成功', async code => {
    runtime.code = code
    await import('../index')
    await vi.waitFor(() => expect(runtime.app.exit).toHaveBeenCalledWith(code))
    expect(runtime.app.quit).not.toHaveBeenCalled()
  })
})
