import { expect, test } from '@playwright/test'
import { spawn } from 'child_process'
import electronPath from 'electron'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs'
import http, { type IncomingMessage, type ServerResponse } from 'http'
import { tmpdir } from 'os'
import { join } from 'path'
import { pathToFileURL } from 'url'

test('CLI export html uses server-render for chart markdown', async () => {
  const { tempDir, inputPath } = createChartFixture()
  const outputPath = join(tempDir, 'chart.html')

  try {
    const { exitCode, stdout, stderr } = await runElectronCli([
      'export',
      inputPath,
      '--format',
      'html',
      '--out',
      outputPath,
      '--json',
    ])

    expect(exitCode, stderr).toBe(0)
    const payload = JSON.parse(stdout)
    expect(payload.ok).toBe(true)
    expect(payload.summary.totalCharts).toBeGreaterThanOrEqual(1)
    expect(payload.summary.failedCharts).toBe(0)

    const html = readFileSync(outputPath, 'utf8')
    expect(html).toContain('mermaid-container')
    expect(html).not.toContain('```mermaid')
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

test('CLI export html hides preview-only chart controls', async ({ page }) => {
  const { tempDir, inputPath } = createChartFixture()
  const outputPath = join(tempDir, 'chart.html')

  try {
    const { exitCode, stdout, stderr } = await runElectronCli([
      'export',
      inputPath,
      '--format',
      'html',
      '--out',
      outputPath,
      '--json',
    ])

    expect(exitCode, stderr).toBe(0)
    const payload = JSON.parse(stdout)
    expect(payload.ok).toBe(true)

    await page.goto(pathToFileURL(outputPath).href)
    const visibility = await page.evaluate(() => {
      const controls = Array.from(document.querySelectorAll('.no-export, [data-no-export="true"]'))
      const visible = controls.filter(element => {
        const style = window.getComputedStyle(element)
        const rect = element.getBoundingClientRect()
        return style.display !== 'none'
          && style.visibility !== 'hidden'
          && rect.width > 0
          && rect.height > 0
      })

      return {
        total: controls.length,
        visible: visible.map(element => ({
          className: element.className,
          text: element.textContent,
        })),
      }
    })

    expect(visibility.total).toBeGreaterThan(0)
    expect(visibility.visible).toEqual([])
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

test('CLI export pdf uses server-render and writes a non-empty PDF artifact', async () => {
  const { tempDir, inputPath } = createChartFixture()
  const outputPath = join(tempDir, 'chart.pdf')

  try {
    const { exitCode, stdout, stderr } = await runElectronCli([
      'export',
      inputPath,
      '--format',
      'pdf',
      '--out',
      outputPath,
      '--json',
    ])

    expect(exitCode, stderr).toBe(0)
    const payload = JSON.parse(stdout)
    expect(payload.ok).toBe(true)
    expect(payload.summary.format).toBe('pdf')
    expect(payload.summary.totalCharts).toBeGreaterThanOrEqual(1)
    expect(payload.summary.failedCharts).toBe(0)
    expect(payload.artifacts).toEqual([
      expect.objectContaining({
        type: 'pdf',
        path: outputPath,
      }),
    ])
    expect(readFileSync(outputPath).subarray(0, 5).toString()).toBe('%PDF-')
    expect(statSync(outputPath).size).toBeGreaterThan(1000)
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

test('CLI export docx calls convert-source service without local headless rendering', async () => {
  const { tempDir, inputPath } = createChartFixture()
  const outputPath = join(tempDir, 'chart.docx')
  let capturedBody: any = null
  const server = await startDocxSourceServer(async (req, res) => {
    expect(req.url).toBe('/convert-source')
    capturedBody = JSON.parse(await readRequestBody(req))
    res.writeHead(200, {
      'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'x-service-version': '0.2.2',
      'x-service-mode': 'fullFidelity',
      'x-render-status': 'success',
      'x-render-failed-blocks': '0',
      'x-charts-rendered': '1',
    })
    res.end(Buffer.from('fake-docx'))
  })

  try {
    const { exitCode, stdout, stderr } = await runElectronCli([
      'export',
      inputPath,
      '--format',
      'docx',
      '--out',
      outputPath,
      '--docx-service',
      server.url,
      '--json',
    ])

    expect(exitCode, stderr).toBe(0)
    const payload = JSON.parse(stdout)
    expect(payload.ok).toBe(true)
    expect(payload.summary.format).toBe('docx')
    expect(payload.summary.serviceVersion).toBe('0.2.2')
    expect(payload.summary.mode).toBe('fullFidelity')
    expect(payload.summary.failedCharts).toBe(0)
    expect(payload.summary.renderedCharts).toBe(1)
    expect(payload.artifacts).toEqual([
      expect.objectContaining({
        type: 'docx',
        path: outputPath,
      }),
    ])
    expect(readFileSync(outputPath, 'utf8')).toBe('fake-docx')
    expect(capturedBody).toMatchObject({
      sourceType: 'markdown',
      style: 'preview',
      renderMode: 'fullFidelity',
      fallbackMode: 'partial',
    })
    expect(capturedBody.markdown).toContain('```mermaid')
  } finally {
    await server.close()
    rmSync(tempDir, { recursive: true, force: true })
  }
})

test('CLI charts list returns rendered chart metadata', async () => {
  const { tempDir, inputPath } = createChartFixture()

  try {
    const { exitCode, stdout, stderr } = await runElectronCli([
      'charts',
      'list',
      inputPath,
      '--json',
    ])

    expect(exitCode, stderr).toBe(0)
    const payload = JSON.parse(stdout)
    expect(payload.ok).toBe(true)
    expect(payload.summary.totalCharts).toBeGreaterThanOrEqual(1)
    expect(payload.results.charts[0]).toEqual(expect.objectContaining({
      index: 1,
      type: 'mermaid',
      selector: expect.stringContaining('data-mdv-render-id'),
    }))
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

test('CLI inspect summarizes markdown structure, charts and broken resources', async () => {
  const { tempDir, inputPath } = createAnalysisFixture()

  try {
    const { exitCode, stdout, stderr } = await runElectronCli([
      'inspect',
      inputPath,
      '--json',
    ])

    expect(exitCode, stderr).toBe(0)
    const payload = JSON.parse(stdout)
    expect(payload.ok).toBe(true)
    expect(payload.command).toBe('inspect')
    expect(payload.summary).toMatchObject({
      headings: 2,
      chartBlocks: 1,
      missingAssets: 1,
      missingMarkdownLinks: 1,
      missingAnchors: 1,
    })
    expect(payload.results.headings[0]).toEqual(expect.objectContaining({
      text: '入口文档',
      id: '入口文档',
    }))
    expect(payload.results.chartBlocks[0]).toEqual(expect.objectContaining({
      type: 'mermaid',
    }))
    expect(payload.warnings.map((warning: { code: string }) => warning.code)).toEqual(expect.arrayContaining([
      'LOCAL_RESOURCE_MISSING',
      'MARKDOWN_LINK_MISSING',
      'ANCHOR_MISSING',
    ]))
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

test('CLI links reports missing files, missing anchors and external links', async () => {
  const { tempDir, inputPath } = createAnalysisFixture()

  try {
    const { exitCode, stdout, stderr } = await runElectronCli([
      'links',
      inputPath,
      '--json',
    ])

    expect(exitCode, stderr).toBe(0)
    const payload = JSON.parse(stdout)
    expect(payload.ok).toBe(true)
    expect(payload.command).toBe('links')
    expect(payload.summary).toMatchObject({
      status: 'issues',
      brokenLinks: 2,
      missingAssets: 1,
      externalLinks: 1,
    })
    expect(payload.results.missingFiles[0]).toEqual(expect.objectContaining({
      target: './missing.md',
    }))
    expect(payload.results.missingAnchors[0]).toEqual(expect.objectContaining({
      target: './target.md#不存在',
    }))
    expect(payload.results.externalLinks[0]).toEqual(expect.objectContaining({
      target: 'https://example.com',
    }))
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

test('CLI render writes diagnostic HTML and chart summary', async () => {
  const { tempDir, inputPath } = createChartFixture()
  const outputPath = join(tempDir, 'render.html')

  try {
    const { exitCode, stdout, stderr } = await runElectronCli([
      'render',
      inputPath,
      '--out',
      outputPath,
      '--json',
    ])

    expect(exitCode, stderr).toBe(0)
    const payload = JSON.parse(stdout)
    expect(payload.ok).toBe(true)
    expect(payload.command).toBe('render')
    expect(payload.summary.totalCharts).toBeGreaterThanOrEqual(1)
    expect(payload.summary.failedCharts).toBe(0)
    expect(payload.results.htmlLength).toBeGreaterThan(100)
    expect(payload.results.charts[0]).toEqual(expect.objectContaining({
      type: 'mermaid',
      selector: expect.stringContaining('data-mdv-render-id'),
    }))
    expect(payload.artifacts).toEqual([
      expect.objectContaining({
        type: 'html',
        path: outputPath,
      }),
    ])
    expect(readFileSync(outputPath, 'utf8')).toContain('mermaid-container')
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

test('CLI screenshot writes a non-empty PNG artifact', async () => {
  const { tempDir, inputPath } = createChartFixture()
  const outputPath = join(tempDir, 'body.png')

  try {
    const { exitCode, stdout, stderr } = await runElectronCli([
      'screenshot',
      inputPath,
      '--selector',
      '.markdown-body',
      '--out',
      outputPath,
      '--json',
    ])

    expect(exitCode, stderr).toBe(0)
    const payload = JSON.parse(stdout)
    expect(payload.ok).toBe(true)
    expect(payload.artifacts).toEqual([
      expect.objectContaining({
        type: 'png',
        path: outputPath,
      }),
    ])
    expect(readFileSync(outputPath).subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
    expect(statSync(outputPath).size).toBeGreaterThan(1000)
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

test('CLI charts export writes chart PNG files to a directory', async () => {
  const { tempDir, inputPath } = createChartFixture()
  const outDir = join(tempDir, 'charts')
  const outZip = join(tempDir, 'charts.zip')

  try {
    const { exitCode, stdout, stderr } = await runElectronCli([
      'charts',
      'export',
      inputPath,
      '--out-dir',
      outDir,
      '--out',
      outZip,
      '--json',
    ])

    expect(exitCode, stderr).toBe(0)
    const payload = JSON.parse(stdout)
    expect(payload.ok).toBe(true)
    expect(payload.summary.exportedCharts).toBeGreaterThanOrEqual(1)
    expect(payload.artifacts[0]).toEqual(expect.objectContaining({
      type: 'png',
    }))
    expect(readFileSync(payload.artifacts[0].path).subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
    expect(statSync(payload.artifacts[0].path).size).toBeGreaterThan(1000)
    const zipArtifact = payload.artifacts.find((artifact: { type: string }) => artifact.type === 'zip')
    expect(zipArtifact).toEqual(expect.objectContaining({
      path: outZip,
      bytes: expect.any(Number),
    }))
    expect(readFileSync(outZip).subarray(0, 2).toString()).toBe('PK')
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

test('CLI batch runs configured jobs and writes reports', async () => {
  const { tempDir, inputPath } = createChartFixture()
  const configPath = join(tempDir, 'batch.json')
  const outPath = join(tempDir, 'batch-result.json')
  const reportPath = join(tempDir, 'batch-report.md')
  const artifactsDir = join(tempDir, 'batch-artifacts')
  writeFileSync(configPath, JSON.stringify({
    documents: [
      {
        path: inputPath,
        exports: ['html'],
        screenshots: ['page', 'charts'],
        expectCharts: true,
        tags: ['e2e', 'chart'],
      },
    ],
  }), 'utf8')

  try {
    const { exitCode, stdout, stderr } = await runElectronCli([
      'batch',
      configPath,
      '--out',
      outPath,
      '--report-md',
      reportPath,
      '--artifacts-dir',
      artifactsDir,
      '--json',
    ])

    expect(exitCode, stderr).toBe(0)
    const payload = JSON.parse(stdout)
    expect(payload.ok).toBe(true)
    expect(payload.summary).toMatchObject({
      totalJobs: 5,
      failedJobs: 0,
    })
    expect(JSON.parse(readFileSync(outPath, 'utf8')).results.jobs).toHaveLength(5)
    expect(readFileSync(reportPath, 'utf8')).toContain('| 5 | chart: 导出图表 | charts | 通过 |')
    expect(readFileSync(join(artifactsDir, '01-chart.html'), 'utf8')).toContain('mermaid-container')
    expect(readFileSync(join(artifactsDir, '01-chart-page.png')).subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
    const chartPng = readdirSync(join(artifactsDir, '01-chart-charts')).find(fileName => fileName.endsWith('.png'))
    expect(chartPng).toBeTruthy()
    expect(statSync(join(artifactsDir, '01-chart-charts', chartPng!)).size).toBeGreaterThan(1000)
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

function createChartFixture(): { tempDir: string; inputPath: string } {
  const tempDir = mkdtempSync(join(tmpdir(), 'mdv-cli-headless-'))
  const inputPath = join(tempDir, 'chart.md')
  writeFileSync(inputPath, '# Chart\n\n```mermaid\ngraph TD\nA --> B\n```', 'utf8')
  return { tempDir, inputPath }
}

function createAnalysisFixture(): { tempDir: string; inputPath: string } {
  const tempDir = mkdtempSync(join(tmpdir(), 'mdv-cli-analysis-e2e-'))
  const inputPath = join(tempDir, 'analysis.md')
  writeFileSync(join(tempDir, 'target.md'), '# 目标\n\n## 锚点\n', 'utf8')
  writeFileSync(inputPath, [
    '# 入口文档',
    '',
    '## 子标题',
    '',
    '[正常](./target.md#锚点)',
    '[缺文件](./missing.md)',
    '[缺锚点](./target.md#不存在)',
    '[外链](https://example.com)',
    '![缺图](./assets/missing.png)',
    '',
    '```mermaid',
    'graph TD',
    '  A --> B',
    '```',
  ].join('\n'), 'utf8')
  return { tempDir, inputPath }
}

async function readRequestBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString('utf8')
}

async function startDocxSourceServer(handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> | void) {
  const server = http.createServer((req, res) => {
    Promise.resolve(handler(req, res)).catch(error => {
      res.writeHead(500, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('无法启动 DOCX mock 服务')
  }
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  }
}

async function runElectronCli(args: string[]): Promise<{
  exitCode: number | null
  stdout: string
  stderr: string
}> {
  const appEntry = join(__dirname, '../out/main/index.js')
  if (!existsSync(appEntry)) {
    throw new Error(`Electron E2E 构建产物不存在：${appEntry}。请先运行 npm run build。`)
  }

  const stdout: string[] = []
  const stderr: string[] = []

  const childProcess = spawn(String(electronPath), [appEntry, ...args], {
    env: {
      ...process.env,
      NODE_ENV: 'test',
      MD_VIEWER_SKIP_RESTORE: '1',
    },
  })

  childProcess.stdout?.on('data', chunk => stdout.push(String(chunk)))
  childProcess.stderr?.on('data', chunk => stderr.push(String(chunk)))

  const exitCode = await new Promise<number | null>((resolve) => {
    childProcess.once('exit', code => resolve(code))
  })

  return {
    exitCode,
    stdout: stdout.join(''),
    stderr: stderr.join(''),
  }
}
