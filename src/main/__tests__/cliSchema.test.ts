import { describe, expect, it } from 'vitest'
import { buildSchemaResult, getCommandSchema, getResultSchema } from '../cli/schemaCommand'

describe('CLI schemas', () => {
  it('exposes the shared result schema', () => {
    const schema = getResultSchema()
    expect(schema.schemaVersion).toBe('1.0')
    expect(schema.required).toEqual(expect.arrayContaining([
      'schemaVersion',
      'ok',
      'command',
      'summary',
      'results',
      'artifacts',
      'warnings',
      'actions',
    ]))
    expect(schema.properties.actions.items.properties.risk.enum).toContain('safe')
  })

  it('exposes command parameter schemas', () => {
    expect(getCommandSchema('export')).toMatchObject({
      command: 'export',
      positional: [{ name: 'input', required: true }],
    })
    expect(getCommandSchema('export')?.flags.format.enum).toEqual(['html', 'pdf', 'docx'])
    expect(getCommandSchema('export')?.flags['docx-service']).toMatchObject({
      type: 'string',
    })
    expect(getCommandSchema('export')?.flags['embed-font']).toMatchObject({
      type: 'boolean',
    })
    expect(getCommandSchema('preflight')?.flags['docx-service']).toMatchObject({
      type: 'string',
    })
    expect(getCommandSchema('screenshot')?.flags).toMatchObject({
      out: { type: 'string' },
      selector: { type: 'string' },
      chart: { type: 'number' },
      width: { type: 'number' },
      height: { type: 'number' },
      scale: { type: 'number' },
    })
    expect(getCommandSchema('charts')?.positional).toEqual([
      { name: 'action', required: true, description: 'list 或 export。' },
      { name: 'input', required: true, description: 'Markdown 文件路径。' },
    ])
    expect(getCommandSchema('charts')?.flags).toMatchObject({
      out: { type: 'string' },
      'out-dir': { type: 'string' },
    })
    expect(getCommandSchema('batch')?.flags).toMatchObject({
      out: { type: 'string' },
      'report-md': { type: 'string' },
      'artifacts-dir': { type: 'string' },
    })
    expect(getCommandSchema('inspect')?.positional).toEqual([
      { name: 'input', required: true, description: 'Markdown 文件路径。' },
    ])
    expect(getCommandSchema('links')?.flags).toMatchObject({
      json: { type: 'boolean' },
    })
    expect(getCommandSchema('render')?.flags).toMatchObject({
      out: { type: 'string' },
      json: { type: 'boolean' },
    })
    expect(getCommandSchema('install-cli')?.flags).toMatchObject({
      json: { type: 'boolean' },
    })
    expect(getCommandSchema('uninstall-cli')?.flags).toMatchObject({
      json: { type: 'boolean' },
    })
    expect(getCommandSchema('unknown')).toBeUndefined()
  })

  it('builds result and command schema responses', () => {
    expect(buildSchemaResult(['result']).results).toMatchObject({
      schema: expect.objectContaining({ name: 'CliResult' }),
    })
    expect(buildSchemaResult(['export']).results).toMatchObject({
      schema: expect.objectContaining({ command: 'export' }),
    })
  })
})
