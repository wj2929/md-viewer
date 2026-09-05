import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const projectRoot = path.resolve(import.meta.dirname, '..')
const budgetPath = path.join(projectRoot, 'config', 'artifact-size-budget.json')
const packageArch = process.env.MD_VIEWER_PACKAGE_ARCH?.trim() || process.arch
const platformKey = `${process.platform}-${packageArch}`
const budgetMode = process.env.MD_VIEWER_SIZE_BUDGET_MODE?.trim() || 'enforce'
const chartExamplesMaxBytes = 420 * 1024
const macOutputDirectory = packageArch === 'x64' ? 'mac' : `mac-${packageArch}`
const unpackedTarget = process.platform === 'darwin'
  ? {
      app: `dist/staged/${macOutputDirectory}/MD Viewer.app`,
      asar: `dist/staged/${macOutputDirectory}/MD Viewer.app/Contents/Resources/app.asar`,
      chartExamples: `dist/staged/${macOutputDirectory}/MD Viewer.app/Contents/Resources/examples/md-viewer-chart-examples.zip`,
    }
  : process.platform === 'win32'
    ? {
        app: 'dist/staged/win-unpacked',
        asar: 'dist/staged/win-unpacked/resources/app.asar',
        chartExamples: 'dist/staged/win-unpacked/resources/examples/md-viewer-chart-examples.zip',
      }
    : {
        app: 'dist/staged/linux-unpacked',
        asar: 'dist/staged/linux-unpacked/resources/app.asar',
        chartExamples: 'dist/staged/linux-unpacked/resources/examples/md-viewer-chart-examples.zip',
      }

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'))
}

async function measure(targetPath) {
  const stats = await fs.lstat(targetPath)
  if (!stats.isDirectory()) return stats.size

  let total = 0
  for (const entry of await fs.readdir(targetPath)) {
    total += await measure(path.join(targetPath, entry))
  }
  return total
}

function validateBudget(name, budget) {
  if (!budget || typeof budget !== 'object') throw new Error(`尺寸预算 ${name} 格式无效`)
  if (typeof budget.relativePath !== 'string' || !budget.relativePath) {
    throw new Error(`尺寸预算 ${name} 缺少 relativePath`)
  }
  for (const field of ['baselineBytes', 'maxBytes', 'maxIncreasePercent']) {
    if (typeof budget[field] !== 'number' || !Number.isFinite(budget[field]) || budget[field] < 0) {
      throw new Error(`尺寸预算 ${name}.${field} 必须是非负数`)
    }
  }
  if (budget.maxBytes < budget.baselineBytes) {
    throw new Error(`尺寸预算 ${name}.maxBytes 不能小于 baselineBytes`)
  }
}

async function main() {
  const config = await readJson(budgetPath)
  if (config.schemaVersion !== 1) throw new Error(`不支持尺寸预算 schemaVersion=${config.schemaVersion}`)

  const budgets = Object.entries(config.artifacts ?? {}).filter(([, budget]) => budget.platformKey === platformKey)
  if (!budgets.length) {
    if (budgetMode !== 'baseline') throw new Error(`缺少 ${platformKey} 的包体尺寸预算`)

    const baseline = {
      platformKey,
      status: 'baseline-required',
      artifacts: [
        { target: 'unpacked-app', relativePath: unpackedTarget.app },
        { target: 'app-asar', relativePath: unpackedTarget.asar },
        { target: 'chart-examples', relativePath: unpackedTarget.chartExamples },
      ],
    }
    const measured = []
    for (const artifact of baseline.artifacts) {
      const targetPath = path.resolve(projectRoot, artifact.relativePath)
      measured.push({ ...artifact, bytes: await measure(targetPath) })
    }
    console.log(JSON.stringify({ ...baseline, artifacts: measured }, null, 2))
    return
  }

  const results = []
  const failures = []
  for (const [name, budget] of budgets) {
    validateBudget(name, budget)
    const targetPath = path.resolve(projectRoot, budget.relativePath)
    const bytes = await measure(targetPath)
    const relativeLimit = Math.ceil(budget.baselineBytes * (1 + budget.maxIncreasePercent / 100))
    const effectiveLimit = Math.min(budget.maxBytes, relativeLimit)
    const passed = bytes <= effectiveLimit
    const result = {
      name,
      bytes,
      baselineBytes: budget.baselineBytes,
      deltaBytes: bytes - budget.baselineBytes,
      maxBytes: budget.maxBytes,
      relativeLimitBytes: relativeLimit,
      effectiveLimitBytes: effectiveLimit,
      passed,
    }
    results.push(result)
    if (!passed) failures.push(result)
  }

  const chartExamplesBytes = await measure(path.resolve(projectRoot, unpackedTarget.chartExamples))
  const chartExamplesResult = {
    name: 'chart-examples',
    bytes: chartExamplesBytes,
    maxBytes: chartExamplesMaxBytes,
    passed: chartExamplesBytes <= chartExamplesMaxBytes,
  }
  results.push(chartExamplesResult)
  if (!chartExamplesResult.passed) failures.push(chartExamplesResult)

  console.log(JSON.stringify({ platformKey, artifacts: results }, null, 2))
  if (failures.length) {
    throw new Error(`包体尺寸超限：${failures.map(item => `${item.name}=${item.bytes}>${item.effectiveLimitBytes ?? item.maxBytes}`).join(', ')}`)
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
