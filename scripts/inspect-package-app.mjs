import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'

const projectRoot = path.resolve(import.meta.dirname, '..')
const stageRoot = path.join(projectRoot, '.package-app')
const runtimeConfigPath = path.join(projectRoot, 'config', 'runtime-dependencies.json')
const chartExamplesDir = path.join(projectRoot, 'resources', 'examples')
const chartExamplesZipPath = path.join(chartExamplesDir, 'md-viewer-chart-examples.zip')
const chartExamplesManifestPath = path.join(chartExamplesDir, 'md-viewer-chart-examples.manifest.json')
const chartExamplesSourcePath = path.join(chartExamplesDir, 'chart-examples.source.json')
const stageRequire = createRequire(path.join(stageRoot, 'package.json'))

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'))
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

async function listFilesByExtension(directory, extensions) {
  const files = []
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await listFilesByExtension(absolute, extensions))
    else if (entry.isFile() && extensions.has(path.extname(entry.name))) files.push(absolute)
  }
  return files
}

async function main() {
  const rootManifest = await readJson(path.join(projectRoot, 'package.json'))
  const stageManifest = await readJson(path.join(stageRoot, 'package.json'))
  const closure = await readJson(path.join(stageRoot, '.runtime-closure.json'))
  const runtimeConfig = await readJson(runtimeConfigPath)
  const chartExamplesManifest = await readJson(chartExamplesManifestPath)
  const chartExamplesSource = await readJson(chartExamplesSourcePath)
  const chartExamplesZip = await fs.readFile(chartExamplesZipPath)
  const chartExamplesSha256 = createHash('sha256').update(chartExamplesZip).digest('hex')
  if (
    chartExamplesManifest.packageId !== 'md-viewer-chart-examples' ||
    chartExamplesManifest.packageVersion !== chartExamplesSource.packageVersion ||
    chartExamplesManifest.minAppVersion !== rootManifest.version ||
    chartExamplesManifest.maxAppVersion !== rootManifest.version ||
    chartExamplesManifest.filename !== path.basename(chartExamplesZipPath) ||
    chartExamplesManifest.bytes !== chartExamplesZip.byteLength ||
    chartExamplesManifest.sha256 !== chartExamplesSha256
  ) {
    throw new Error('内置图表示例包与 sidecar manifest 不一致')
  }

  for (const field of ['name', 'version', 'main']) {
    if (stageManifest[field] !== rootManifest[field]) {
      throw new Error(`stage ${field}=${stageManifest[field]} 与根 manifest=${rootManifest[field]} 不一致`)
    }
  }
  if (!await pathExists(path.join(stageRoot, stageManifest.main))) {
    throw new Error(`stage main 不存在：${stageManifest.main}`)
  }
  for (const relativePath of ['out/preload/index.js', 'out/renderer/index.html', 'out/renderer/server-render.html']) {
    if (!await pathExists(path.join(stageRoot, relativePath))) throw new Error(`stage 缺少 ${relativePath}`)
  }

  const declared = Object.keys(stageManifest.dependencies ?? {}).sort()
  const expected = [...runtimeConfig.runtimeDependencies].sort()
  if (JSON.stringify(declared) !== JSON.stringify(expected)) {
    throw new Error(`stage direct dependencies 不匹配：${declared.join(', ')}`)
  }
  for (const dependency of expected) {
    stageRequire.resolve(dependency)
  }

  for (const entry of closure.packages) {
    const manifestPath = path.join(stageRoot, entry.path, 'package.json')
    const manifest = await readJson(manifestPath)
    if (manifest.version !== entry.version) {
      throw new Error(`${entry.path} 实际版本 ${manifest.version} 与 closure ${entry.version} 不一致`)
    }
  }

  const forbiddenTopLevel = [
    '@excalidraw/excalidraw',
    'bpmn-js',
    'echarts',
    'katex',
    'mermaid',
    'react',
    'react-dom',
    'vega',
    'wavedrom',
  ]
  for (const dependency of forbiddenTopLevel) {
    const dependencyPath = path.join(stageRoot, 'node_modules', ...dependency.split('/'))
    if (await pathExists(dependencyPath)) {
      throw new Error(`renderer-only 顶层依赖不应进入 stage：${dependency}`)
    }
  }

  const fontFiles = await listFilesByExtension(path.join(stageRoot, 'out', 'renderer'), new Set(['.ttf', '.woff', '.woff2']))
  const fontCounts = fontFiles.reduce((counts, file) => {
    const extension = path.extname(file)
    counts[extension] = (counts[extension] ?? 0) + 1
    return counts
  }, {})
  if ((fontCounts['.ttf'] ?? 0) !== 0 || (fontCounts['.woff'] ?? 0) !== 0 || fontCounts['.woff2'] !== 20) {
    throw new Error(`KaTeX 字体输出异常：${JSON.stringify(fontCounts)}`)
  }

  console.log(JSON.stringify({
    version: stageManifest.version,
    directDependencies: expected.length,
    closurePackages: closure.packages.length,
    rendererOnlyTopLevelExcluded: forbiddenTopLevel.length,
    katexFonts: fontCounts,
    chartExamplesBytes: chartExamplesZip.byteLength,
    chartExamplesCaseCount: chartExamplesManifest.caseCount,
  }, null, 2))
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
