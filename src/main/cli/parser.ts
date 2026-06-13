import type { CliCommandName, CliParseResult } from './types'

const automationCommands = new Set<CliCommandName>([
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
])

const previewablePathPattern = /[\\/]|\.m(?:d|arkdown|down|kd|dx)$/i

export function parseCliArgs(argv: string[]): CliParseResult {
  const args = stripRuntimeArgs(argv)
  const [commandCandidate, ...rest] = args

  if (!commandCandidate) {
    return { kind: 'gui', argv: args }
  }

  if (!automationCommands.has(commandCandidate as CliCommandName)) {
    if (previewablePathPattern.test(commandCandidate) || commandCandidate === '.') {
      return { kind: 'gui', argv: args }
    }
    return {
      kind: 'invalid',
      command: commandCandidate,
      code: 'UNKNOWN_COMMAND',
      message: `未知 CLI 命令：${commandCandidate}`,
    }
  }

  const { positional, flags } = parsePositionalsAndFlags(rest)
  return {
    kind: 'automation',
    command: commandCandidate as CliCommandName,
    positional,
    flags,
  }
}

function stripRuntimeArgs(argv: string[]): string[] {
  if (argv.length >= 2 && /(?:electron|node|MD Viewer|md-viewer)$/i.test(argv[0])) {
    return stripAppEntrypoint(argv.slice(1))
  }
  return stripAppEntrypoint(argv)
}

function stripAppEntrypoint(args: string[]): string[] {
  const [first, second] = args
  if (!first || !second) {
    return args
  }

  if (/(?:^|[\\/])out[\\/]main[\\/]index\.js$/i.test(first) || /(?:^|[\\/])index\.js$/i.test(first)) {
    return args.slice(1)
  }

  return args
}

function parsePositionalsAndFlags(args: string[]): {
  positional: string[]
  flags: Record<string, string | boolean>
} {
  const positional: string[] = []
  const flags: Record<string, string | boolean> = {}

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (!arg.startsWith('--')) {
      positional.push(arg)
      continue
    }

    const flagBody = arg.slice(2)
    const equalIndex = flagBody.indexOf('=')
    if (equalIndex >= 0) {
      flags[flagBody.slice(0, equalIndex)] = flagBody.slice(equalIndex + 1)
      continue
    }

    const next = args[index + 1]
    if (next && !next.startsWith('--')) {
      flags[flagBody] = next
      index += 1
    } else {
      flags[flagBody] = true
    }
  }

  return { positional, flags }
}
