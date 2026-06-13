import { describe, expect, it } from 'vitest'
import { runCli } from '../cli'

function createIo() {
  const stdout: string[] = []
  const stderr: string[] = []
  return {
    io: {
      stdout: (text: string) => stdout.push(text),
      stderr: (text: string) => stderr.push(text),
    },
    stdout,
    stderr,
  }
}

describe('runCli', () => {
  it('writes capabilities JSON to stdout only', async () => {
    const { io, stdout, stderr } = createIo()

    const exitCode = await runCli(['capabilities', '--json'], io)

    expect(exitCode).toBe(0)
    expect(stderr).toEqual([])
    expect(stdout).toHaveLength(1)
    expect(JSON.parse(stdout[0])).toMatchObject({
      schemaVersion: '1.0',
      ok: true,
      command: 'capabilities',
    })
  })

  it('writes human help when json is not requested', async () => {
    const { io, stdout, stderr } = createIo()

    const exitCode = await runCli(['help'], io)

    expect(exitCode).toBe(0)
    expect(stderr).toEqual([])
    expect(stdout.join('')).toContain('MD Viewer CLI')
    expect(() => JSON.parse(stdout.join(''))).toThrow()
  })

  it('writes schema JSON for a command', async () => {
    const { io, stdout } = createIo()

    const exitCode = await runCli(['schema', 'export', '--json'], io)

    expect(exitCode).toBe(0)
    expect(JSON.parse(stdout[0])).toMatchObject({
      ok: true,
      command: 'schema',
      results: {
        schema: {
          command: 'export',
        },
      },
    })
  })

  it('returns structured JSON for unknown commands', async () => {
    const { io, stdout } = createIo()

    const exitCode = await runCli(['unknown', '--json'], io)

    expect(exitCode).toBe(2)
    expect(JSON.parse(stdout[0])).toMatchObject({
      ok: false,
      command: 'unknown',
      code: 'UNKNOWN_COMMAND',
      actions: [
        {
          command: 'md-viewer help --json',
          risk: 'safe',
        },
      ],
    })
  })

  it('dispatches implemented screenshot and charts commands instead of NOT_IMPLEMENTED', async () => {
    const { io, stdout } = createIo()

    const screenshotExit = await runCli(['screenshot', '--json'], io)
    const chartsExit = await runCli(['charts', '--json'], io)

    expect(screenshotExit).toBe(2)
    expect(chartsExit).toBe(2)
    expect(JSON.parse(stdout[0])).toMatchObject({
      command: 'screenshot',
      code: 'INVALID_ARGUMENT',
    })
    expect(JSON.parse(stdout[1])).toMatchObject({
      command: 'charts',
      code: 'INVALID_ARGUMENT',
    })
    expect(stdout.join('\n')).not.toContain('NOT_IMPLEMENTED')
  })

  it('dispatches implemented P1a commands instead of NOT_IMPLEMENTED', async () => {
    const { io, stdout } = createIo()

    const inspectExit = await runCli(['inspect', '--json'], io)
    const linksExit = await runCli(['links', '--json'], io)
    const renderExit = await runCli(['render', '--json'], io)

    expect(inspectExit).toBe(2)
    expect(linksExit).toBe(2)
    expect(renderExit).toBe(2)
    expect(JSON.parse(stdout[0])).toMatchObject({
      command: 'inspect',
      code: 'INVALID_ARGUMENT',
    })
    expect(JSON.parse(stdout[1])).toMatchObject({
      command: 'links',
      code: 'INVALID_ARGUMENT',
    })
    expect(JSON.parse(stdout[2])).toMatchObject({
      command: 'render',
      code: 'INVALID_ARGUMENT',
    })
    expect(stdout.join('\n')).not.toContain('NOT_IMPLEMENTED')
  })
})
