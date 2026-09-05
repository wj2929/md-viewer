import { app } from 'electron'
import { isHeadlessCliArgv } from './cli/parserMode'
import { installEpipeHandler } from './safeLog'

installEpipeHandler()

const startupArgv = process.argv.slice(1)

if (isHeadlessCliArgv(startupArgv)) {
  app.on('window-all-closed', () => undefined)
  void import('./cli/bootstrap').then(({ runCliOnStartup }) =>
    runCliOnStartup(startupArgv, {
      exit: code => {
        process.stderr.write('', () => {
          process.stdout.write('', () => setImmediate(() => app.exit(code)))
        })
      },
    })
  )
} else {
  void import('./gui')
}
