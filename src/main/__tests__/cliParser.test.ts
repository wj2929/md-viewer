import { describe, expect, it } from 'vitest'
import { parseCliArgs } from '../cli/parser'

describe('parseCliArgs', () => {
  it('supports top-level help and version switches', () => {
    expect(parseCliArgs(['--help'])).toEqual({
      kind: 'automation',
      command: 'help',
      positional: [],
      flags: {},
    })
    expect(parseCliArgs(['-h'])).toEqual({
      kind: 'automation',
      command: 'help',
      positional: [],
      flags: {},
    })
    expect(parseCliArgs(['--version'])).toEqual({
      kind: 'meta',
      action: 'version',
      argv: ['--version'],
    })
    expect(parseCliArgs(['-v'])).toEqual({
      kind: 'meta',
      action: 'version',
      argv: ['-v'],
    })
  })

  it('parses automation commands with boolean and value flags', () => {
    expect(parseCliArgs(['capabilities', '--json'])).toEqual({
      kind: 'automation',
      command: 'capabilities',
      positional: [],
      flags: { json: true },
    })

    expect(parseCliArgs(['export', 'report.md', '--format', 'pdf', '--out', 'report.pdf'])).toEqual({
      kind: 'automation',
      command: 'export',
      positional: ['report.md'],
      flags: { format: 'pdf', out: 'report.pdf' },
    })
  })

  it('strips Electron entrypoint before automation commands', () => {
    expect(parseCliArgs(['/Applications/MD Viewer.app/Contents/MacOS/MD Viewer', 'out/main/index.js', 'export', 'report.md', '--format', 'html', '--out', 'report.html'])).toEqual({
      kind: 'automation',
      command: 'export',
      positional: ['report.md'],
      flags: { format: 'html', out: 'report.html' },
    })
  })

  it('strips app entrypoint when startup argv already removed the Electron binary', () => {
    expect(parseCliArgs(['out/main/index.js', 'export', 'report.md', '--format', 'html', '--out', 'report.html'])).toEqual({
      kind: 'automation',
      command: 'export',
      positional: ['report.md'],
      flags: { format: 'html', out: 'report.html' },
    })
  })

  it('keeps help and schema subcommands as positional arguments', () => {
    expect(parseCliArgs(['help', 'export', '--json'])).toEqual({
      kind: 'automation',
      command: 'help',
      positional: ['export'],
      flags: { json: true },
    })

    expect(parseCliArgs(['schema', 'result', '--json'])).toEqual({
      kind: 'automation',
      command: 'schema',
      positional: ['result'],
      flags: { json: true },
    })
  })

  it('returns gui for normal launch paths', () => {
    expect(parseCliArgs(['/tmp/report.md'])).toEqual({
      kind: 'gui',
      argv: ['/tmp/report.md'],
    })
  })

  it('ignores Electron runtime flags before GUI paths', () => {
    expect(parseCliArgs([
      '--inspect=0',
      '--remote-debugging-port=0',
      '--user-data-dir=/tmp/md-viewer-test',
      '--lang=zh-CN',
      '/tmp/report.md',
    ])).toEqual({
      kind: 'gui',
      argv: ['/tmp/report.md'],
    })
  })

  it('keeps runtime-looking flags after an automation command', () => {
    expect(parseCliArgs(['render', 'README.md', '--out', 'render.html', '--lang=zh-CN'])).toEqual({
      kind: 'automation',
      command: 'render',
      positional: ['README.md'],
      flags: { out: 'render.html', lang: 'zh-CN' },
    })
  })

  it('returns invalid for unknown automation commands', () => {
    expect(parseCliArgs(['unknown', '--json'])).toEqual({
      kind: 'invalid',
      command: 'unknown',
      code: 'UNKNOWN_COMMAND',
      message: '未知 CLI 命令：unknown',
    })
  })

  it('routes implemented P1a analysis commands', () => {
    expect(parseCliArgs(['inspect', 'README.md', '--json'])).toEqual({
      kind: 'automation',
      command: 'inspect',
      positional: ['README.md'],
      flags: { json: true },
    })
    expect(parseCliArgs(['links', 'README.md', '--json'])).toEqual({
      kind: 'automation',
      command: 'links',
      positional: ['README.md'],
      flags: { json: true },
    })
    expect(parseCliArgs(['render', 'README.md', '--out', 'render.html'])).toEqual({
      kind: 'automation',
      command: 'render',
      positional: ['README.md'],
      flags: { out: 'render.html' },
    })
    expect(parseCliArgs(['diff', 'before.md', 'after.md', '--fail-on-change', '--json'])).toEqual({
      kind: 'automation',
      command: 'diff',
      positional: ['before.md', 'after.md'],
      flags: { 'fail-on-change': true, json: true },
    })
    expect(parseCliArgs(['watch', 'docs', '--jsonl', '--max-events', '10'])).toEqual({
      kind: 'automation',
      command: 'watch',
      positional: ['docs'],
      flags: { jsonl: true, 'max-events': '10' },
    })
  })

  it('routes CLI shim install commands', () => {
    expect(parseCliArgs(['install-cli', '--json'])).toEqual({
      kind: 'automation',
      command: 'install-cli',
      positional: [],
      flags: { json: true },
    })
    expect(parseCliArgs(['uninstall-cli', '--json'])).toEqual({
      kind: 'automation',
      command: 'uninstall-cli',
      positional: [],
      flags: { json: true },
    })
  })
})
