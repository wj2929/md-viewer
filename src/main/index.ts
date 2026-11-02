import { app } from 'electron'
import { isHeadlessCliArgv } from './cli/parserMode'
import { installEpipeHandler } from './safeLog'

installEpipeHandler()

const startupArgv = process.argv.slice(1)

if (startupArgv.some(arg => arg.startsWith('--md-viewer-pdf-helper='))) {
  app.on('window-all-closed', () => undefined)
  void import('./pdf/pdfWorker').then(({ runPdfWorker }) => runPdfWorker()).catch(() => app.exit(1))
} else if (isHeadlessCliArgv(startupArgv)) {
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
