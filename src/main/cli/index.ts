import { buildBatchResult } from './batchCommand'
import { buildCapabilitiesResult } from './capabilitiesCommand'
import { buildChartsResult } from './chartsCommand'
import { buildDoctorResult } from './doctorCommand'
import { buildExportResult } from './exportCommand'
import { buildHelpResult, renderHumanHelp } from './helpCommand'
import { buildInspectResult } from './inspectCommand'
import { buildLinksResult } from './linksCommand'
import { buildOpenResult } from './openCommand'
import { parseCliArgs } from './parser'
import { buildPreflightResult } from './preflightCommand'
import { buildRenderResult } from './renderCommand'
import { createFailureResult, getExitCode, stringifyCliResult } from './result'
import { buildSchemaResult } from './schemaCommand'
import { buildScreenshotResult } from './screenshotCommand'
import { buildInstallCliResult, buildUninstallCliResult } from './shimCommand'
import type { CliResult } from './types'

export interface CliIo {
  stdout: (text: string) => void
  stderr: (text: string) => void
}

export function isAutomationCliArgv(argv: string[]): boolean {
  const parsed = parseCliArgs(argv)
  return parsed.kind === 'automation' || parsed.kind === 'invalid'
}

export function isHeadlessCliArgv(argv: string[]): boolean {
  const parsed = parseCliArgs(argv)
  return parsed.kind === 'invalid' || (parsed.kind === 'automation' && parsed.command !== 'open')
}

export async function runCli(argv: string[], io: CliIo = defaultIo): Promise<number> {
  const parsed = parseCliArgs(argv)

  if (parsed.kind === 'gui') {
    return -1
  }

  if (parsed.kind === 'invalid') {
    const result = createFailureResult(parsed.command, {
      code: parsed.code,
      message: parsed.message,
      exitCode: 2,
      actions: [
        {
          label: '查看全部命令',
          command: 'md-viewer help --json',
          target: 'help',
          risk: 'safe',
        },
      ],
    })
    writeJson(io, result)
    return getExitCode(result)
  }

  if (parsed.command === 'help' && !wantsJson(parsed.flags)) {
    io.stdout(renderHumanHelp())
    return 0
  }

  const result = await dispatchAutomationCommand(parsed.command, parsed.positional, parsed.flags)
  writeJson(io, result)
  return getExitCode(result)
}

async function dispatchAutomationCommand(
  command: string,
  positional: string[],
  flags: Record<string, string | boolean>,
): Promise<CliResult> {
  switch (command) {
    case 'capabilities':
      return buildCapabilitiesResult()
    case 'schema':
      return buildSchemaResult(positional)
    case 'help':
      return buildHelpResult(positional)
    case 'open':
      return buildOpenResult(positional, flags)
    case 'export':
      return buildExportResult(positional, flags)
    case 'preflight':
      return buildPreflightResult(positional, flags)
    case 'doctor':
      return buildDoctorResult(flags)
    case 'charts':
      return buildChartsResult(positional, flags)
    case 'screenshot':
      return buildScreenshotResult(positional, flags)
    case 'batch':
      return buildBatchResult(positional, flags)
    case 'inspect':
      return buildInspectResult(positional, flags)
    case 'links':
      return buildLinksResult(positional, flags)
    case 'render':
      return buildRenderResult(positional, flags)
    case 'install-cli':
      return buildInstallCliResult(flags)
    case 'uninstall-cli':
      return buildUninstallCliResult()
    default:
      return createFailureResult(command, {
        code: 'NOT_IMPLEMENTED',
        message: `CLI 命令尚未实现：${command}`,
        target: command,
        exitCode: 1,
        actions: [
          {
            label: '查看当前可用能力',
            command: 'md-viewer capabilities --json',
            target: 'capabilities',
            risk: 'safe',
          },
        ],
      })
  }
}

function wantsJson(flags: Record<string, string | boolean>): boolean {
  return flags.json === true || flags.output === 'json'
}

function writeJson(io: CliIo, result: CliResult): void {
  io.stdout(stringifyCliResult(result))
}

const defaultIo: CliIo = {
  stdout: text => process.stdout.write(text),
  stderr: text => process.stderr.write(text),
}
