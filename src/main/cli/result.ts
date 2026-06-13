import { CLI_SCHEMA_VERSION, type CliAction, type CliArtifact, type CliResult, type CliWarning } from './types'

const DEFAULT_FAILURE_EXIT_CODE = 1

const exitCodes = new WeakMap<CliResult, number>()

interface SuccessOptions {
  summary?: Record<string, unknown>
  results?: Record<string, unknown>
  artifacts?: CliArtifact[]
  warnings?: CliWarning[]
  actions?: CliAction[]
  diagnostics?: Record<string, unknown>
}

interface FailureOptions extends SuccessOptions {
  code: string
  message: string
  target?: string
  exitCode?: number
}

export function createSuccessResult(command: string, options: SuccessOptions = {}): CliResult {
  const result: CliResult = {
    schemaVersion: CLI_SCHEMA_VERSION,
    ok: true,
    command,
    summary: options.summary ?? {},
    results: options.results ?? {},
    artifacts: options.artifacts ?? [],
    warnings: options.warnings ?? [],
    actions: options.actions ?? [],
    ...(options.diagnostics ? { diagnostics: options.diagnostics } : {}),
  }
  exitCodes.set(result, 0)
  return result
}

export function createFailureResult(command: string, options: FailureOptions): CliResult {
  const result: CliResult = {
    schemaVersion: CLI_SCHEMA_VERSION,
    ok: false,
    command,
    code: options.code,
    message: options.message,
    ...(options.target ? { target: options.target } : {}),
    summary: options.summary ?? {},
    results: options.results ?? {},
    artifacts: options.artifacts ?? [],
    warnings: options.warnings ?? [],
    actions: options.actions ?? [],
    ...(options.diagnostics ? { diagnostics: options.diagnostics } : {}),
  }
  exitCodes.set(result, options.exitCode ?? DEFAULT_FAILURE_EXIT_CODE)
  return result
}

export function getExitCode(result: CliResult): number {
  return exitCodes.get(result) ?? (result.ok ? 0 : DEFAULT_FAILURE_EXIT_CODE)
}

export function stringifyCliResult(result: CliResult): string {
  return `${JSON.stringify(result, null, 2)}\n`
}
