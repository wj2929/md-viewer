import { describe, expect, it, vi } from 'vitest'
import { buildInstallCliResult, buildUninstallCliResult } from '../cli/shimCommand'

describe('CLI shim commands', () => {
  it('returns install result with PATH guidance', async () => {
    const result = await buildInstallCliResult({}, {
      installCliShim: vi.fn(async () => ({
        ok: true,
        path: '/Users/tester/.local/bin/md-viewer',
        pathInShell: false,
        nextStep: '请把命令目录加入 PATH',
      })),
      uninstallCliShim: vi.fn(),
    })

    expect(result.ok).toBe(true)
    expect(result.command).toBe('install-cli')
    expect(result.summary).toMatchObject({
      installed: true,
      pathInShell: false,
    })
    expect(result.artifacts).toEqual([
      { type: 'cli-shim', path: '/Users/tester/.local/bin/md-viewer' },
    ])
    expect(result.actions).toEqual([
      {
        label: '请把命令目录加入 PATH',
        target: 'shell-profile',
        risk: 'safe',
      },
    ])
  })

  it('returns structured failure when uninstall refuses to remove external file', async () => {
    const result = await buildUninstallCliResult({
      installCliShim: vi.fn(),
      uninstallCliShim: vi.fn(async () => ({
        ok: false,
        path: '/usr/local/bin/md-viewer',
        code: 'CLI_SHIM_NOT_OWNED',
        message: '不是 MD Viewer 生成的命令',
      })),
    })

    expect(result.ok).toBe(false)
    expect(result.command).toBe('uninstall-cli')
    expect(result.code).toBe('CLI_SHIM_NOT_OWNED')
    expect(result.target).toBe('/usr/local/bin/md-viewer')
  })
})
