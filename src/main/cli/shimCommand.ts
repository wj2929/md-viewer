import { installCliShim, uninstallCliShim } from '../cliShimInstaller'
import { createFailureResult, createSuccessResult } from './result'

interface CliShimDeps {
  installCliShim: typeof installCliShim
  uninstallCliShim: typeof uninstallCliShim
}

const defaultDeps: CliShimDeps = {
  installCliShim,
  uninstallCliShim,
}

export async function buildInstallCliResult(
  _flags: Record<string, string | boolean> = {},
  deps: CliShimDeps = defaultDeps,
) {
  const result = await deps.installCliShim()
  if (!result.ok) {
    return createFailureResult('install-cli', {
      code: result.code ?? 'CLI_SHIM_INSTALL_FAILED',
      message: result.message ?? '安装 md-viewer 命令失败。',
      target: result.path,
      exitCode: 1,
    })
  }

  return createSuccessResult('install-cli', {
    summary: {
      installed: true,
      path: result.path,
      pathInShell: result.pathInShell,
    },
    artifacts: result.path ? [{ type: 'cli-shim', path: result.path }] : [],
    actions: result.nextStep
      ? [
          {
            label: result.nextStep,
            target: result.pathInShell ? 'terminal' : 'shell-profile',
            risk: 'safe',
          },
        ]
      : [],
  })
}

export async function buildUninstallCliResult(deps: CliShimDeps = defaultDeps) {
  const result = await deps.uninstallCliShim()
  if (!result.ok) {
    return createFailureResult('uninstall-cli', {
      code: result.code ?? 'CLI_SHIM_UNINSTALL_FAILED',
      message: result.message ?? '卸载 md-viewer 命令失败。',
      target: result.path,
      exitCode: 1,
    })
  }

  return createSuccessResult('uninstall-cli', {
    summary: {
      uninstalled: true,
      path: result.path,
    },
    actions: result.nextStep
      ? [
          {
            label: result.nextStep,
            target: 'terminal',
            risk: 'safe',
          },
        ]
      : [],
  })
}
