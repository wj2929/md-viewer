import fsSync from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { spawnSync } from 'node:child_process'

const projectRoot = path.resolve(import.meta.dirname, '..')
const fixturePath = path.join(projectRoot, 'e2e', 'fixtures', 'shown-source.md')
const packageArch = process.env.MD_VIEWER_PACKAGE_ARCH?.trim() || process.arch
const platformTarget = process.platform === 'darwin'
  ? packageArch === 'x64'
    ? 'dist/staged/mac/MD Viewer.app/Contents/MacOS/MD Viewer'
    : `dist/staged/mac-${packageArch}/MD Viewer.app/Contents/MacOS/MD Viewer`
  : process.platform === 'win32'
    ? 'dist/staged/win-unpacked/MD Viewer.exe'
    : 'dist/staged/linux-unpacked/md-viewer'
const executablePath = path.join(projectRoot, platformTarget)

function actionableStderr(stderr) {
  return stderr.split(/\r?\n/).filter(line => {
    const value = line.trim()
    if (!value) return false
    if (process.platform !== 'linux') return true
    return !/^\[\d+:\d+\/\d+\.\d+:ERROR:(?:dbus\/|gpu\/|components\/viz\/)/.test(value)
  }).join('\n')
}

async function run(args, timeout = 90_000) {
  const processOutputDir = fsSync.mkdtempSync(path.join(os.tmpdir(), 'md-viewer-packaged-command-'))
  const stdinFd = fsSync.openSync(os.devNull, 'r')
  const stdoutPath = path.join(processOutputDir, 'stdout.json')
  const stderrPath = path.join(processOutputDir, 'stderr.log')
  const stdoutFd = fsSync.openSync(stdoutPath, 'w')
  const stderrFd = fsSync.openSync(stderrPath, 'w')
  let child
  try {
    child = spawnSync(executablePath, args, {
      timeout,
      stdio: [stdinFd, stdoutFd, stderrFd],
      env: {
        ...process.env,
        MD_VIEWER_DISABLE_UPDATE_CHECK: '1',
        ...(process.platform === 'linux' ? { ELECTRON_DISABLE_SANDBOX: '1' } : {}),
      },
    })
  } finally {
    fsSync.closeSync(stdinFd)
    fsSync.closeSync(stdoutFd)
    fsSync.closeSync(stderrFd)
  }
  const stdout = fsSync.readFileSync(stdoutPath, 'utf8')
  const stderr = fsSync.readFileSync(stderrPath, 'utf8')
  fsSync.rmSync(processOutputDir, { recursive: true, force: true })
  if (child.error) throw child.error
  if (child.status !== 0) {
    throw new Error(`${args.join(' ')} 退出码异常：${child.status}\nstdout: ${stdout.trim()}\nstderr: ${stderr.trim()}`)
  }
  const stderrFailure = actionableStderr(stderr)
  if (stderrFailure) throw new Error(`${args[0]} stderr 非空：${stderrFailure}`)
  const result = JSON.parse(stdout)
  if (result.ok !== true) throw new Error(`${args[0]} 返回失败：${stdout}`)
  return result
}

async function assertFile(filePath, signature, minimumBytes = signature.length) {
  const bytes = await fs.readFile(filePath)
  if (bytes.length < minimumBytes) throw new Error(`${path.basename(filePath)} 体积异常：${bytes.length}`)
  if (!bytes.subarray(0, signature.length).equals(signature)) {
    throw new Error(`${path.basename(filePath)} 文件签名异常`)
  }
}

function assertChartSummary(result, command) {
  if (result.summary?.totalCharts !== 1 || result.summary?.renderedCharts !== 1 || result.summary?.failedCharts !== 0) {
    throw new Error(`${command} 图表摘要异常：${JSON.stringify(result.summary)}`)
  }
}

async function main() {
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'md-viewer-packaged-smoke-'))
  try {
    const capabilities = await run(['capabilities', '--json'], 30_000)
    if (capabilities.command !== 'capabilities') throw new Error('capabilities command 字段异常')

    const inspect = await run(['inspect', fixturePath, '--json'], 30_000)
    if (inspect.summary?.chartBlocks !== 1 || inspect.results?.chartBlocks?.[0]?.type !== 'mermaid') {
      throw new Error(`inspect 图表识别异常：${JSON.stringify(inspect.summary)}`)
    }

    const renderPath = path.join(outputDir, 'render.html')
    const render = await run(['render', fixturePath, '--out', renderPath, '--json'])
    assertChartSummary(render, 'render')
    const renderedHtml = await fs.readFile(renderPath, 'utf8')
    if (!renderedHtml.includes('mermaid-container')) throw new Error('render HTML 缺少 Mermaid 容器')

    const htmlPath = path.join(outputDir, 'export.html')
    const html = await run(['export', fixturePath, '--format', 'html', '--out', htmlPath, '--json'])
    assertChartSummary(html, 'export html')
    if (!(await fs.readFile(htmlPath, 'utf8')).includes('mermaid-container')) {
      throw new Error('export HTML 缺少 Mermaid 容器')
    }

    const pdfPath = path.join(outputDir, 'export.pdf')
    const pdf = await run(['export', fixturePath, '--format', 'pdf', '--out', pdfPath, '--json'])
    assertChartSummary(pdf, 'export pdf')
    await assertFile(pdfPath, Buffer.from('%PDF-'), 1024)

    const screenshotPath = path.join(outputDir, 'body.png')
    await run(['screenshot', fixturePath, '--selector', '.markdown-body', '--out', screenshotPath, '--json'])
    await assertFile(screenshotPath, Buffer.from('89504e470d0a1a0a', 'hex'), 1024)

    const charts = await run(['charts', 'list', fixturePath, '--json'])
    assertChartSummary(charts, 'charts list')
    if (charts.results?.charts?.[0]?.type !== 'mermaid') throw new Error('charts list 未返回 Mermaid')

    const chartsDir = path.join(outputDir, 'charts')
    const chartsZip = path.join(outputDir, 'charts.zip')
    const exportedCharts = await run(['charts', 'export', fixturePath, '--out-dir', chartsDir, '--out', chartsZip, '--json'])
    if (exportedCharts.summary?.exportedCharts !== 1) throw new Error('charts export 数量异常')
    await assertFile(chartsZip, Buffer.from('PK'), 100)
    const chartPngs = (await fs.readdir(chartsDir)).filter(file => file.endsWith('.png'))
    if (chartPngs.length !== 1) throw new Error(`charts export PNG 数量异常：${chartPngs.length}`)
    await assertFile(path.join(chartsDir, chartPngs[0]), Buffer.from('89504e470d0a1a0a', 'hex'), 1024)

    const commands = ['capabilities', 'inspect', 'render', 'export:html', 'export:pdf', 'screenshot', 'charts:list', 'charts:export']
    const docxServiceUrl = process.env.MD_VIEWER_DOCX_SERVICE_URL?.trim()
    if (docxServiceUrl) {
      const docxPath = path.join(outputDir, 'export.docx')
      const docx = await run([
        'export',
        fixturePath,
        '--format',
        'docx',
        '--out',
        docxPath,
        '--docx-service',
        docxServiceUrl,
        '--json',
      ], 180_000)
      if (
        docx.summary?.format !== 'docx' ||
        docx.summary?.renderStatus !== 'success' ||
        docx.summary?.renderedCharts !== 1 ||
        docx.summary?.failedCharts !== 0
      ) {
        throw new Error(`export docx 摘要异常：${JSON.stringify(docx.summary)}`)
      }
      await assertFile(docxPath, Buffer.from('PK'), 1024)
      commands.push('export:docx')
    }

    console.log(JSON.stringify({
      executable: path.relative(projectRoot, executablePath),
      fixture: path.relative(projectRoot, fixturePath),
      commands,
      charts: 1,
      docxService: Boolean(docxServiceUrl),
    }, null, 2))
  } finally {
    await fs.rm(outputDir, { recursive: true, force: true })
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
