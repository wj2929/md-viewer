import { parseCliArgs } from './parser'

export function isAutomationCliArgv(argv: string[]): boolean {
  const parsed = parseCliArgs(argv)
  return parsed.kind === 'automation' || parsed.kind === 'invalid' || parsed.kind === 'meta'
}

export function isHeadlessCliArgv(argv: string[]): boolean {
  const parsed = parseCliArgs(argv)
  return parsed.kind === 'invalid' || parsed.kind === 'meta' ||
    (parsed.kind === 'automation' && parsed.command !== 'open')
}
