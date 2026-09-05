import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'

const require = createRequire(import.meta.url)
const projectRoot = path.resolve(import.meta.dirname, '..')
const playwrightCli = require.resolve('@playwright/test/cli')
const child = spawn(process.execPath, [playwrightCli, 'test', 'e2e/packaged-tts-smoke.spec.ts'], {
  cwd: projectRoot,
  env: {
    ...process.env,
    MD_VIEWER_PACKAGED_E2E: '1',
    MD_VIEWER_E2E_VISIBLE: '0',
    MD_VIEWER_PACKAGE_ARCH: process.env.MD_VIEWER_PACKAGE_ARCH ?? '',
  },
  stdio: 'inherit',
})

child.on('error', error => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`packaged E2E 被信号 ${signal} 终止`)
    process.exitCode = 1
    return
  }
  process.exitCode = code ?? 1
})
