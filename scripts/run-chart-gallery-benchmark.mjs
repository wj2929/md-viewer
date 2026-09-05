import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function run(args, env = process.env) {
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    env,
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

run(['scripts/generate-chart-examples.mjs', '--benchmark-candidates'])
run([
  path.join(root, 'node_modules/@playwright/test/cli.js'),
  'test',
  'e2e/chart-gallery-benchmark.spec.ts',
  ...process.argv.slice(2),
], {
  ...process.env,
  MD_VIEWER_CHART_BENCHMARK: '1',
})
