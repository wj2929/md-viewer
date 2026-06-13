import { describe, expect, it } from 'vitest'
import { buildCapabilitiesResult, getCapabilities } from '../cli/capabilitiesCommand'

describe('CLI capabilities', () => {
  it('lists P0 and implemented P1a commands with dependencies and schema entries', () => {
    const capabilities = getCapabilities()
    const commands = capabilities.commands.map(command => command.name)

    expect(capabilities.schemaVersion).toBe('1.0')
    expect(commands).toEqual(expect.arrayContaining([
      'capabilities',
      'schema',
      'help',
      'open',
      'export',
      'preflight',
      'doctor',
      'screenshot',
      'charts',
      'batch',
      'inspect',
      'render',
      'links',
      'install-cli',
      'uninstall-cli',
    ]))
    expect(capabilities.commands.find(command => command.name === 'export')).toMatchObject({
      stability: 'stable',
      schema: 'schema export --json',
      requires: ['headless-renderer'],
    })
    expect(capabilities.commands.find(command => command.name === 'inspect')).toMatchObject({
      stability: 'experimental',
      schema: 'schema inspect --json',
      requires: [],
    })
    expect(capabilities.commands.find(command => command.name === 'render')).toMatchObject({
      stability: 'experimental',
      requires: ['headless-renderer'],
    })
  })

  it('builds a standard JSON result', () => {
    const result = buildCapabilitiesResult()
    expect(result.ok).toBe(true)
    expect(result.command).toBe('capabilities')
    expect(result.summary).toMatchObject({
      commands: expect.any(Number),
      schemaVersion: '1.0',
    })
  })
})
