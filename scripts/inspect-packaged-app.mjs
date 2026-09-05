import fsSync from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { listPackage } from '@electron/asar'
import AdmZip from 'adm-zip'

const projectRoot = path.resolve(import.meta.dirname, '..')
const stagedDistRoot = path.join(projectRoot, 'dist', 'staged')
const localeConfigPath = path.join(projectRoot, 'config', 'package-locales.json')
const chartExamplesSourcePath = path.join(projectRoot, 'resources', 'examples', 'chart-examples.source.json')
const chartExamplesSidecarName = 'md-viewer-chart-examples.manifest.json'
const chartExamplesZipName = 'md-viewer-chart-examples.zip'
const packageArch = process.env.MD_VIEWER_PACKAGE_ARCH?.trim() || process.arch
const platformTarget = process.platform === 'darwin'
  ? {
      output: packageArch === 'x64' ? 'mac/MD Viewer.app' : `mac-${packageArch}/MD Viewer.app`,
      resources: 'Contents/Resources',
      executable: 'Contents/MacOS/MD Viewer',
    }
  : process.platform === 'win32'
    ? { output: 'win-unpacked', resources: 'resources', executable: 'MD Viewer.exe' }
    : { output: 'linux-unpacked', resources: 'resources', executable: 'md-viewer' }

async function pathExists(filePath) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

async function directorySize(targetPath) {
  const stats = await fs.lstat(targetPath)
  if (!stats.isDirectory()) return stats.size
  let total = 0
  for (const entry of await fs.readdir(targetPath)) total += await directorySize(path.join(targetPath, entry))
  return total
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'))
}

function inspectChartExamplesArchive(zipBuffer, source, sidecar) {
  const zip = new AdmZip(zipBuffer)
  const actualEntries = zip.getEntries().map(entry => entry.entryName).sort()
  const manifestEntry = zip.getEntry('md-viewer-chart-examples/manifest.json')
  if (!manifestEntry) throw new Error('packaged 图表示例 ZIP 缺少内部 manifest')
  const manifest = JSON.parse(manifestEntry.getData().toString('utf8'))
  if (
    manifest.schemaVersion !== source.schemaVersion ||
    manifest.packageId !== source.packageId ||
    manifest.packageVersion !== source.packageVersion ||
    manifest.packageVersion !== sidecar.packageVersion ||
    manifest.designCaseCount !== source.expectedCaseCount ||
    manifest.totalCaseCount !== sidecar.totalCaseCount ||
    manifest.rendererCount !== sidecar.rendererCount
  ) {
    throw new Error('packaged 图表示例 ZIP 内部 manifest 元数据不一致')
  }

  const expectedEntries = [
    ...manifest.files.map(file => `md-viewer-chart-examples/${file.name}`),
    'md-viewer-chart-examples/manifest.json',
  ].sort()
  if (JSON.stringify(actualEntries) !== JSON.stringify(expectedEntries)) {
    throw new Error('packaged 图表示例 ZIP 条目不符合内部白名单')
  }
  for (const file of manifest.files) {
    const entry = zip.getEntry(`md-viewer-chart-examples/${file.name}`)
    if (!entry) throw new Error(`packaged 图表示例 ZIP 缺少 ${file.name}`)
    const content = entry.getData()
    const digest = createHash('sha256').update(content).digest('hex')
    if (content.byteLength !== file.bytes || digest !== file.sha256) {
      throw new Error(`packaged 图表示例文件校验失败：${file.name}`)
    }
  }
  return actualEntries
}

async function listPackagedLocales(appPath) {
  if (process.platform === 'darwin') {
    const frameworkResources = path.join(
      appPath,
      'Contents',
      'Frameworks',
      'Electron Framework.framework',
      'Versions',
      'A',
      'Resources',
    )
    return (await fs.readdir(frameworkResources))
      .filter(entry => entry.endsWith('.lproj'))
      .map(entry => entry.slice(0, -'.lproj'.length))
      .sort()
  }

  const localesPath = path.join(appPath, 'locales')
  return (await fs.readdir(localesPath))
    .filter(entry => entry.endsWith('.pak'))
    .map(entry => entry.slice(0, -'.pak'.length))
    .sort()
}

async function main() {
  const appPath = path.join(stagedDistRoot, platformTarget.output)
  const resourcesPath = path.join(appPath, platformTarget.resources)
  const executablePath = path.join(appPath, platformTarget.executable)
  const asarPath = path.join(resourcesPath, 'app.asar')
  const localeConfig = await readJson(localeConfigPath)
  const expectedLocales = [...(localeConfig.expectedLocaleNames?.[process.platform] ?? [])].sort()
  if (!expectedLocales.length) throw new Error(`缺少 ${process.platform} 的 locale 期望配置`)
  const packagedLocales = await listPackagedLocales(appPath)
  if (JSON.stringify(packagedLocales) !== JSON.stringify(expectedLocales)) {
    throw new Error(`packaged locales 不匹配：实际 ${packagedLocales.join(', ')}；期望 ${expectedLocales.join(', ')}`)
  }
  for (const required of [executablePath, asarPath]) {
    if (!await pathExists(required)) throw new Error(`packaged app 缺少 ${path.relative(projectRoot, required)}`)
  }
  for (const resource of ['reference.docx', 'reference-gongwen.docx', 'lua', 'icon.png']) {
    if (!await pathExists(path.join(resourcesPath, resource))) throw new Error(`packaged app 缺少资源 ${resource}`)
  }

  const chartExamplesDir = path.join(resourcesPath, 'examples')
  const chartExamplesZipPath = path.join(chartExamplesDir, chartExamplesZipName)
  const chartExamplesSidecarPath = path.join(chartExamplesDir, chartExamplesSidecarName)
  for (const required of [chartExamplesZipPath, chartExamplesSidecarPath]) {
    if (!await pathExists(required)) throw new Error(`packaged app 缺少图表示例资源 ${path.basename(required)}`)
  }
  const chartExamplesSource = await readJson(chartExamplesSourcePath)
  const chartExamplesSidecar = await readJson(chartExamplesSidecarPath)
  const chartExamplesZip = await fs.readFile(chartExamplesZipPath)
  const chartExamplesSha256 = createHash('sha256').update(chartExamplesZip).digest('hex')
  if (chartExamplesSidecar.bytes !== chartExamplesZip.byteLength || chartExamplesSidecar.sha256 !== chartExamplesSha256) {
    throw new Error('packaged 图表示例 ZIP 与 sidecar manifest 不一致')
  }
  if (chartExamplesSidecar.packageVersion !== (await readJson(path.join(projectRoot, 'package.json'))).version) {
    throw new Error(`packaged 图表示例版本异常：${chartExamplesSidecar.packageVersion}`)
  }
  const actualChartEntries = inspectChartExamplesArchive(chartExamplesZip, chartExamplesSource, chartExamplesSidecar)

  const asarEntries = await listPackage(asarPath)
  const runtimeClosure = await readJson(path.join(projectRoot, '.package-app', '.runtime-closure.json'))
  for (const packageEntry of runtimeClosure.packages ?? []) {
    const packageName = packageEntry.path.slice(packageEntry.path.lastIndexOf('node_modules/') + 'node_modules/'.length)
    const manifestCandidates = [
      `/${packageEntry.path}/package.json`,
      `/node_modules/${packageName}/package.json`,
    ]
    if (!manifestCandidates.some(candidate => asarEntries.includes(candidate))) {
      throw new Error(`app.asar 缺少 runtime closure 包 ${packageEntry.path}`)
    }
  }
  for (const required of ['/package.json', '/out/main/index.js', '/out/preload/index.js', '/out/renderer/index.html']) {
    if (!asarEntries.includes(required)) throw new Error(`app.asar 缺少 ${required}`)
  }
  for (const forbidden of ['react', 'react-dom', 'mermaid', 'katex', 'bpmn-js', '@excalidraw/excalidraw']) {
    const prefix = `/node_modules/${forbidden}`
    if (asarEntries.some(entry => entry === prefix || entry.startsWith(`${prefix}/`))) {
      throw new Error(`app.asar 不应包含 renderer-only 顶层包 ${forbidden}`)
    }
  }

  const fontEntries = asarEntries.filter(entry => /\.(?:ttf|woff|woff2)$/.test(entry))
  const fontCounts = fontEntries.reduce((counts, entry) => {
    const extension = path.extname(entry)
    counts[extension] = (counts[extension] ?? 0) + 1
    return counts
  }, {})
  if ((fontCounts['.ttf'] ?? 0) !== 0 || (fontCounts['.woff'] ?? 0) !== 0 || fontCounts['.woff2'] !== 20) {
    throw new Error(`packaged KaTeX 字体异常：${JSON.stringify(fontCounts)}`)
  }

  const cliOutputDir = fsSync.mkdtempSync(path.join(os.tmpdir(), 'md-viewer-packaged-inspect-'))
  const stdinFd = fsSync.openSync(os.devNull, 'r')
  const stdoutPath = path.join(cliOutputDir, 'stdout.json')
  const stderrPath = path.join(cliOutputDir, 'stderr.log')
  const stdoutFd = fsSync.openSync(stdoutPath, 'w')
  const stderrFd = fsSync.openSync(stderrPath, 'w')
  let cliRun
  try {
    cliRun = spawnSync(executablePath, ['capabilities', '--json'], {
      timeout: 30_000,
      stdio: [stdinFd, stdoutFd, stderrFd],
    })
  } finally {
    fsSync.closeSync(stdinFd)
    fsSync.closeSync(stdoutFd)
    fsSync.closeSync(stderrFd)
  }
  const stdout = fsSync.readFileSync(stdoutPath, 'utf8')
  const stderr = fsSync.readFileSync(stderrPath, 'utf8')
  fsSync.rmSync(cliOutputDir, { recursive: true, force: true })
  if (cliRun.error) throw cliRun.error
  if (cliRun.status !== 0) throw new Error(`packaged CLI 退出码异常：${cliRun.status}`)
  if (stderr.trim()) throw new Error(`packaged CLI stderr 非空：${stderr.trim()}`)
  const cliResult = JSON.parse(stdout)
  if (cliResult.ok !== true || cliResult.command !== 'capabilities') {
    throw new Error('packaged CLI capabilities 返回失败')
  }

  console.log(JSON.stringify({
    app: path.relative(projectRoot, appPath),
    appBytes: await directorySize(appPath),
    asarBytes: (await fs.stat(asarPath)).size,
    asarEntries: asarEntries.length,
    locales: packagedLocales,
    katexFonts: fontCounts,
    chartExamplesBytes: chartExamplesZip.byteLength,
    chartExamplesEntries: actualChartEntries.length,
    chartExamplesCaseCount: chartExamplesSidecar.caseCount,
    cliSchemaVersion: cliResult.schemaVersion,
  }, null, 2))
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
