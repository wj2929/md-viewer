export const CLI_SCHEMA_VERSION = '1.0' as const

export type CliCommandName =
  | 'capabilities'
  | 'schema'
  | 'help'
  | 'open'
  | 'export'
  | 'preflight'
  | 'doctor'
  | 'screenshot'
  | 'charts'
  | 'batch'
  | 'inspect'
  | 'render'
  | 'links'
  | 'install-cli'
  | 'uninstall-cli'

export type CliActionRisk = 'safe' | 'writes-file' | 'network' | 'starts-service' | 'destructive'

export interface CliAction {
  label: string
  command?: string
  docsUrl?: string
  target?: string
  risk: CliActionRisk
}

export interface CliWarning {
  code: string
  message: string
  target?: string
  action?: CliAction
}

export interface CliArtifact {
  type: string
  path: string
  bytes?: number
}

export interface CliResult {
  schemaVersion: typeof CLI_SCHEMA_VERSION
  ok: boolean
  command: string
  summary: Record<string, unknown>
  results: Record<string, unknown>
  artifacts: CliArtifact[]
  warnings: CliWarning[]
  actions: CliAction[]
  diagnostics?: Record<string, unknown>
  code?: string
  message?: string
  target?: string
}

export type CliParseResult =
  | {
      kind: 'automation'
      command: CliCommandName
      positional: string[]
      flags: Record<string, string | boolean>
    }
  | {
      kind: 'gui'
      argv: string[]
    }
  | {
      kind: 'invalid'
      command: string
      code: 'UNKNOWN_COMMAND'
      message: string
    }

export interface CliCapability {
  name: CliCommandName
  description: string
  stability: 'stable' | 'experimental' | 'planned'
  schema: string
  requires: string[]
  examples: string[]
}

export interface CliCapabilities {
  schemaVersion: typeof CLI_SCHEMA_VERSION
  commands: CliCapability[]
  formats: string[]
  chartTypes: string[]
  networkPolicy: 'disabled-by-default' | 'enabled'
}

export interface CliCommandSchema {
  command: CliCommandName | 'result'
  description: string
  positional: Array<{ name: string; required: boolean; description: string }>
  flags: Record<string, { type: string; required?: boolean; enum?: string[]; description: string }>
}
