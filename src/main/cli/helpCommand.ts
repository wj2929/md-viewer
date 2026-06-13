import { getRegisteredCapabilities } from './capabilitiesRegistry'
import { createFailureResult, createSuccessResult } from './result'

export function buildHelpResult(positional: string[] = []) {
  const capabilities = getRegisteredCapabilities()
  const target = positional[0]

  if (!target) {
    return createSuccessResult('help', {
      summary: {
        commands: capabilities.commands.length,
      },
      results: {
        commands: capabilities.commands.map(command => ({
          name: command.name,
          description: command.description,
          examples: command.examples,
        })),
      },
    })
  }

  const command = capabilities.commands.find(command => command.name === target)
  if (!command) {
    return createFailureResult('help', {
      code: 'UNKNOWN_COMMAND',
      message: `未知 CLI 命令：${target}`,
      target,
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
  }

  return createSuccessResult('help', {
    summary: {
      command: command.name,
      stability: command.stability,
    },
    results: {
      ...command,
      command: command.name,
    } as unknown as Record<string, unknown>,
  })
}

export function renderHumanHelp(): string {
  return [
    'MD Viewer CLI',
    '',
    '常用命令：',
    '  md-viewer capabilities --json',
    '  md-viewer schema export --json',
    '  md-viewer help export --json',
    '  md-viewer open README.md',
    '  md-viewer export README.md --format pdf --out README.pdf',
    '  md-viewer screenshot README.md --selector ".markdown-body" --out README.png',
    '  md-viewer charts list README.md --json',
    '  md-viewer inspect README.md --json',
    '  md-viewer links README.md --json',
    '  md-viewer render README.md --out render.html --json',
    '  md-viewer install-cli --json',
    '  md-viewer preflight README.md --format docx --json',
    '  md-viewer doctor --json',
    '  md-viewer batch e2e/local-real-docs.json --out test-results/release-report.json',
    '',
  ].join('\n')
}
