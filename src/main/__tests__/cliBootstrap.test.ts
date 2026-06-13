import { describe, expect, it, vi } from 'vitest'
import { runCliOnStartup } from '../cli/bootstrap'

describe('runCliOnStartup', () => {
  it('runs automation commands before GUI startup and exits with CLI code', async () => {
    const exit = vi.fn()
    const result = await runCliOnStartup(['capabilities', '--json'], {
      exit,
      runner: async () => 0,
    })

    expect(result.handled).toBe(true)
    expect(exit).toHaveBeenCalledWith(0)
  })

  it('does not intercept normal markdown launch paths', async () => {
    const exit = vi.fn()
    const result = await runCliOnStartup(['/tmp/report.md'], { exit })

    expect(result.handled).toBe(false)
    expect(exit).not.toHaveBeenCalled()
  })

  it('does not intercept the GUI open command', async () => {
    const exit = vi.fn()
    const result = await runCliOnStartup(['open', '/tmp/report.md'], { exit })

    expect(result.handled).toBe(false)
    expect(exit).not.toHaveBeenCalled()
  })

  it('exits with 1 when the CLI runner throws', async () => {
    const exit = vi.fn()
    const stderr = vi.fn()
    const result = await runCliOnStartup(['capabilities', '--json'], {
      exit,
      stderr,
      runner: async () => {
        throw new Error('boom')
      },
    })

    expect(result.handled).toBe(true)
    expect(stderr).toHaveBeenCalledWith('[CLI] boom\n')
    expect(exit).toHaveBeenCalledWith(1)
  })
})
