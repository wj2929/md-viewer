import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, stat, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { buildBatchResult } from '../cli/batchCommand'
import { createFailureResult, createSuccessResult } from '../cli/result'

let tempDir: string | null = null

async function createConfig(data: unknown): Promise<string> {
  tempDir = await mkdtemp(path.join(tmpdir(), 'mdv-cli-batch-'))
  const configPath = path.join(tempDir, 'batch.json')
  await writeFile(configPath, JSON.stringify(data, null, 2), 'utf8')
  return configPath
}

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true })
    tempDir = null
  }
})

describe('buildBatchResult', () => {
  it('runs configured jobs and writes JSON and Markdown reports', async () => {
    const configPath = await createConfig({
      jobs: [
        {
          name: '检查 PDF 导出风险',
          command: 'preflight',
          positional: ['/tmp/report.md'],
          flags: { format: 'pdf' },
        },
        {
          name: '列出图表',
          command: 'charts',
          positional: ['list', '/tmp/report.md'],
          flags: { json: true },
        },
      ],
    })
    const out = path.join(tempDir!, 'batch-result.json')
    const reportMd = path.join(tempDir!, 'batch-report.md')
    const runner = vi.fn(async (command: string) => createSuccessResult(command, {
      summary: { status: 'ok' },
    }))

    const result = await buildBatchResult([configPath], { out, 'report-md': reportMd }, { runner })

    expect(result).toMatchObject({
      ok: true,
      command: 'batch',
      summary: {
        totalJobs: 2,
        passedJobs: 2,
        failedJobs: 0,
      },
      artifacts: [
        { type: 'json', path: out },
        { type: 'markdown', path: reportMd },
      ],
    })
    expect(runner).toHaveBeenNthCalledWith(1, 'preflight', ['/tmp/report.md'], { format: 'pdf' })
    expect(runner).toHaveBeenNthCalledWith(2, 'charts', ['list', '/tmp/report.md'], { json: true })
    expect(JSON.parse(await readFile(out, 'utf8'))).toMatchObject({
      summary: { totalJobs: 2, failedJobs: 0 },
      results: {
        jobs: [
          { index: 1, name: '检查 PDF 导出风险', command: 'preflight', ok: true },
          { index: 2, name: '列出图表', command: 'charts', ok: true },
        ],
      },
    })
    expect(await readFile(reportMd, 'utf8')).toContain('| 1 | 检查 PDF 导出风险 | preflight | 通过 |')
  })

  it('returns a structured failure when any job fails', async () => {
    const configPath = await createConfig({
      jobs: [
        { command: 'preflight', positional: ['/tmp/report.md'], flags: { format: 'pdf' } },
        { command: 'export', positional: ['/tmp/report.md'], flags: { format: 'pdf', out: '/tmp/report.pdf' } },
      ],
    })
    const runner = vi
      .fn()
      .mockResolvedValueOnce(createSuccessResult('preflight'))
      .mockResolvedValueOnce(createFailureResult('export', {
        code: 'OUTPUT_NOT_WRITABLE',
        message: '无法写入输出文件',
      }))

    const result = await buildBatchResult([configPath], {}, { runner })

    expect(result).toMatchObject({
      ok: false,
      command: 'batch',
      code: 'PARTIAL_FAILURE',
      summary: {
        totalJobs: 2,
        passedJobs: 1,
        failedJobs: 1,
      },
      results: {
        jobs: [
          { index: 1, command: 'preflight', ok: true },
          { index: 2, command: 'export', ok: false, code: 'OUTPUT_NOT_WRITABLE' },
        ],
      },
    })
  })

  it('expands document regression entries into export, screenshot, and chart jobs', async () => {
    const configPath = await createConfig({
      documents: [
        {
          path: 'fixtures/audit.md',
          exports: ['pdf', 'docx'],
          screenshots: ['page', 'charts'],
          expectCharts: true,
          tags: ['fixture', 'chart-heavy'],
          timeoutMs: 180000,
        },
      ],
    })
    const artifactsDir = path.join(tempDir!, 'artifacts')
    const input = path.join(path.dirname(configPath), 'fixtures/audit.md')
    const runner = vi.fn(async (command: string) => createSuccessResult(command, {
      summary: command === 'charts' ? { totalCharts: 2 } : { status: 'ok' },
    }))

    const result = await buildBatchResult([configPath], { 'artifacts-dir': artifactsDir }, { runner })

    expect(result).toMatchObject({
      ok: true,
      summary: {
        totalJobs: 7,
        passedJobs: 7,
        failedJobs: 0,
      },
    })
    expect(runner).toHaveBeenNthCalledWith(1, 'preflight', [input], { format: 'pdf' })
    expect(runner).toHaveBeenNthCalledWith(2, 'export', [input], {
      format: 'pdf',
      out: path.join(artifactsDir, '01-audit.pdf'),
    })
    expect(runner).toHaveBeenNthCalledWith(3, 'preflight', [input], { format: 'docx' })
    expect(runner).toHaveBeenNthCalledWith(4, 'export', [input], {
      format: 'docx',
      out: path.join(artifactsDir, '01-audit.docx'),
    })
    expect(runner).toHaveBeenNthCalledWith(5, 'screenshot', [input], {
      selector: '.markdown-body',
      out: path.join(artifactsDir, '01-audit-page.png'),
    })
    expect(runner).toHaveBeenNthCalledWith(6, 'charts', ['list', input], { json: true })
    expect(runner).toHaveBeenNthCalledWith(7, 'charts', ['export', input], {
      'out-dir': path.join(artifactsDir, '01-audit-charts'),
    })
    expect(result.results.jobs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'audit: 导出 pdf',
        command: 'export',
        tags: ['fixture', 'chart-heavy'],
      }),
    ]))
    await expect(stat(artifactsDir)).resolves.toMatchObject({
      isDirectory: expect.any(Function),
    })
    await expect(stat(path.join(artifactsDir, '01-audit-charts'))).resolves.toMatchObject({
      isDirectory: expect.any(Function),
    })
  })

  it('fails a document regression when expected charts are not detected', async () => {
    const configPath = await createConfig({
      documents: [
        {
          path: '/tmp/plain.md',
          expectCharts: true,
        },
      ],
    })
    const runner = vi.fn(async () => createSuccessResult('charts', {
      summary: { totalCharts: 0 },
    }))

    const result = await buildBatchResult([configPath], {}, { runner })

    expect(result).toMatchObject({
      ok: false,
      code: 'PARTIAL_FAILURE',
      summary: {
        totalJobs: 1,
        passedJobs: 0,
        failedJobs: 1,
      },
      results: {
        jobs: [
          {
            command: 'charts',
            ok: false,
            code: 'EXPECTED_CHARTS_NOT_FOUND',
          },
        ],
      },
    })
  })
})
