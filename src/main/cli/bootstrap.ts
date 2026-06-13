import { isHeadlessCliArgv, runCli } from '.'

interface StartupCliOptions {
  exit: (code: number) => void
  stderr?: (text: string) => void
  runner?: (argv: string[]) => Promise<number>
}

export async function runCliOnStartup(
  argv: string[],
  options: StartupCliOptions,
): Promise<{ handled: boolean }> {
  if (!isHeadlessCliArgv(argv)) {
    return { handled: false }
  }

  const stderr = options.stderr ?? (text => process.stderr.write(text))
  const runner = options.runner ?? runCli

  try {
    const exitCode = await runner(argv)
    options.exit(exitCode)
  } catch (error) {
    stderr(`[CLI] ${error instanceof Error ? error.message : String(error)}\n`)
    options.exit(1)
  }

  return { handled: true }
}
