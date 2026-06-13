import { mkdir, readFile, stat, writeFile } from 'fs/promises'
import path from 'path'
import { buildCapabilitiesResult } from './capabilitiesCommand'
import { buildChartsResult } from './chartsCommand'
import { buildDoctorResult } from './doctorCommand'
import { buildExportResult } from './exportCommand'
import { buildHelpResult } from './helpCommand'
import { buildPreflightResult } from './preflightCommand'
import { createFailureResult, createSuccessResult } from './result'
import { buildSchemaResult } from './schemaCommand'
import { buildScreenshotResult } from './screenshotCommand'
import type { CliArtifact, CliResult } from './types'

type BatchRunner = (
  command: string,
  positional: string[],
  flags: Record<string, string | boolean>,
) => Promise<CliResult> | CliResult

interface BatchJobConfig {
  name?: string
  command: string
  positional?: string[]
  flags?: Record<string, string | boolean>
  tags?: string[]
  expectations?: {
    charts?: boolean
  }
}

interface BatchDocumentConfig {
  path: string
  exports?: string[]
  screenshots?: string[]
  expectCharts?: boolean
  tags?: string[]
  timeoutMs?: number
}

interface BatchConfig {
  jobs: BatchJobConfig[]
}

interface BuildBatchResultOptions {
  runner?: BatchRunner
}

export async function buildBatchResult(
  positional: string[],
  flags: Record<string, string | boolean>,
  options: BuildBatchResultOptions = {},
) {
  const configPath = positional[0]
  if (!configPath) {
    return createFailureResult('batch', {
      code: 'INVALID_ARGUMENT',
      message: 'batch 需要批量配置 JSON 文件路径',
      exitCode: 2,
      actions: [
        {
          label: '查看 batch 命令帮助',
          command: 'md-viewer help batch --json',
          target: 'batch',
          risk: 'safe',
        },
      ],
    })
  }

  const config = await readBatchConfig(configPath, flags)
  if (!config.ok) {
    return createFailureResult('batch', {
      code: 'INVALID_CONFIG',
      message: config.message,
      target: configPath,
      exitCode: 2,
      actions: [
        {
          label: '检查批量配置 JSON',
          command: 'md-viewer schema batch --json',
          target: 'batch',
          risk: 'safe',
        },
      ],
    })
  }

  const runner = options.runner ?? runBatchJob
  const jobs = []
  let passedJobs = 0
  let failedJobs = 0

  for (const [index, job] of config.data.jobs.entries()) {
    await ensureJobOutputDirectories(job)
    const result = applyJobExpectations(
      job,
      await runner(job.command, job.positional ?? [], job.flags ?? {}),
    )
    if (result.ok) {
      passedJobs += 1
    } else {
      failedJobs += 1
    }
    jobs.push({
      index: index + 1,
      name: job.name,
      command: job.command,
      ok: result.ok,
      code: result.code,
      message: result.message,
      summary: result.summary,
      artifacts: result.artifacts,
      warnings: result.warnings,
      tags: job.tags,
    })

    if (flags['fail-fast'] === true && !result.ok) {
      break
    }
  }

  const summary = {
    config: path.resolve(configPath),
    totalJobs: jobs.length,
    passedJobs,
    failedJobs,
  }
  const artifacts: CliArtifact[] = []
  const payload = {
    summary,
    results: { jobs },
  }

  if (typeof flags.out === 'string') {
    artifacts.push(await writeJsonReport(flags.out, payload))
  }
  if (typeof flags['report-md'] === 'string') {
    artifacts.push(await writeMarkdownReport(flags['report-md'], jobs))
  }

  const optionsForResult = {
    summary,
    results: { jobs },
    artifacts,
  }

  if (failedJobs > 0) {
    return createFailureResult('batch', {
      ...optionsForResult,
      code: 'PARTIAL_FAILURE',
      message: `批量任务失败：${failedJobs}/${jobs.length}`,
      exitCode: 1,
    })
  }

  return createSuccessResult('batch', optionsForResult)
}

async function readBatchConfig(
  configPath: string,
  flags: Record<string, string | boolean>,
): Promise<
  | { ok: true; data: BatchConfig }
  | { ok: false; message: string }
> {
  try {
    const raw = await readFile(configPath, 'utf8')
    const parsed = JSON.parse(raw) as {
      jobs?: BatchJobConfig[]
      documents?: BatchDocumentConfig[]
    }
    const jobs: BatchJobConfig[] = []

    if (parsed.jobs !== undefined) {
      if (!Array.isArray(parsed.jobs)) {
        return { ok: false, message: 'jobs 必须是数组' }
      }
      for (const [index, job] of parsed.jobs.entries()) {
        const validation = validateBatchJob(job, index)
        if (!validation.ok) {
          return validation
        }
      }
      jobs.push(...parsed.jobs)
    }

    if (parsed.documents !== undefined) {
      if (!Array.isArray(parsed.documents)) {
        return { ok: false, message: 'documents 必须是数组' }
      }
      const baseDir = path.dirname(path.resolve(configPath))
      const artifactsDir = buildArtifactsDir(configPath, flags)
      const expanded = expandDocumentJobs(parsed.documents, baseDir, artifactsDir)
      if (!expanded.ok) {
        return expanded
      }
      jobs.push(...expanded.jobs)
    }

    if (jobs.length === 0) {
      return { ok: false, message: '批量配置必须包含 jobs 数组或 documents 数组' }
    }

    return { ok: true, data: { jobs } }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

function validateBatchJob(
  job: BatchJobConfig,
  index: number,
): { ok: true } | { ok: false; message: string } {
  if (!job || typeof job.command !== 'string') {
    return { ok: false, message: `jobs[${index}] 缺少 command` }
  }
  if (job.positional && !Array.isArray(job.positional)) {
    return { ok: false, message: `jobs[${index}].positional 必须是数组` }
  }
  if (job.flags && (typeof job.flags !== 'object' || Array.isArray(job.flags))) {
    return { ok: false, message: `jobs[${index}].flags 必须是对象` }
  }
  if (job.tags && !isStringArray(job.tags)) {
    return { ok: false, message: `jobs[${index}].tags 必须是字符串数组` }
  }
  return { ok: true }
}

function expandDocumentJobs(
  documents: BatchDocumentConfig[],
  baseDir: string,
  artifactsDir: string,
): { ok: true; jobs: BatchJobConfig[] } | { ok: false; message: string } {
  const jobs: BatchJobConfig[] = []

  for (const [index, document] of documents.entries()) {
    const validation = validateBatchDocument(document, index)
    if (!validation.ok) {
      return validation
    }

    const input = path.isAbsolute(document.path) ? document.path : path.resolve(baseDir, document.path)
    const baseName = sanitizeFileBase(path.basename(input, path.extname(input)))
    const artifactPrefix = `${String(index + 1).padStart(2, '0')}-${baseName}`
    const label = baseName
    const tags = document.tags
    const exports = document.exports ?? []
    const screenshots = document.screenshots ?? []

    for (const format of exports) {
      jobs.push({
        name: `${label}: 预检 ${format}`,
        command: 'preflight',
        positional: [input],
        flags: { format },
        tags,
      })
      jobs.push({
        name: `${label}: 导出 ${format}`,
        command: 'export',
        positional: [input],
        flags: {
          format,
          out: path.join(artifactsDir, `${artifactPrefix}.${format}`),
        },
        tags,
      })
    }

    if (screenshots.includes('page')) {
      jobs.push({
        name: `${label}: 页面截图`,
        command: 'screenshot',
        positional: [input],
        flags: {
          selector: '.markdown-body',
          out: path.join(artifactsDir, `${artifactPrefix}-page.png`),
        },
        tags,
      })
    }

    const needsChartList = document.expectCharts === true || screenshots.includes('charts')
    if (needsChartList) {
      jobs.push({
        name: `${label}: 图表清单`,
        command: 'charts',
        positional: ['list', input],
        flags: { json: true },
        tags,
        expectations: document.expectCharts === true ? { charts: true } : undefined,
      })
    }

    if (screenshots.includes('charts')) {
      jobs.push({
        name: `${label}: 导出图表`,
        command: 'charts',
        positional: ['export', input],
        flags: {
          'out-dir': path.join(artifactsDir, `${artifactPrefix}-charts`),
        },
        tags,
      })
    }
  }

  if (jobs.length === 0) {
    return { ok: false, message: 'documents 没有展开出可执行任务' }
  }

  return { ok: true, jobs }
}

function validateBatchDocument(
  document: BatchDocumentConfig,
  index: number,
): { ok: true } | { ok: false; message: string } {
  if (!document || typeof document.path !== 'string' || document.path.trim() === '') {
    return { ok: false, message: `documents[${index}] 缺少 path` }
  }
  if (document.exports !== undefined) {
    if (!isStringArray(document.exports)) {
      return { ok: false, message: `documents[${index}].exports 必须是字符串数组` }
    }
    const invalid = document.exports.find(format => !['html', 'pdf', 'docx'].includes(format))
    if (invalid) {
      return { ok: false, message: `documents[${index}].exports 包含不支持的格式：${invalid}` }
    }
  }
  if (document.screenshots !== undefined) {
    if (!isStringArray(document.screenshots)) {
      return { ok: false, message: `documents[${index}].screenshots 必须是字符串数组` }
    }
    const invalid = document.screenshots.find(target => !['page', 'charts'].includes(target))
    if (invalid) {
      return { ok: false, message: `documents[${index}].screenshots 包含不支持的目标：${invalid}` }
    }
  }
  if (document.tags !== undefined && !isStringArray(document.tags)) {
    return { ok: false, message: `documents[${index}].tags 必须是字符串数组` }
  }
  return { ok: true }
}

function applyJobExpectations(job: BatchJobConfig, result: CliResult): CliResult {
  if (job.expectations?.charts !== true || !result.ok) {
    return result
  }

  const totalCharts = readChartCount(result)
  if (totalCharts > 0) {
    return result
  }

  return createFailureResult(result.command, {
    code: 'EXPECTED_CHARTS_NOT_FOUND',
    message: '配置声明该文档应包含图表，但 charts list 未检测到图表',
    target: job.positional?.[1] ?? job.positional?.[0],
    summary: result.summary,
    results: result.results,
    artifacts: result.artifacts,
    warnings: result.warnings,
    actions: [
      {
        label: '检查 Markdown 图表围栏语言或渲染器支持',
        command: 'md-viewer charts list <file> --json',
        target: 'charts',
        risk: 'safe',
      },
    ],
  })
}

function readChartCount(result: CliResult): number {
  const summaryCount = result.summary.totalCharts
  if (typeof summaryCount === 'number') {
    return summaryCount
  }
  const charts = result.results.charts
  if (Array.isArray(charts)) {
    return charts.length
  }
  return 0
}

function buildArtifactsDir(configPath: string, flags: Record<string, string | boolean>): string {
  if (typeof flags['artifacts-dir'] === 'string') {
    return path.resolve(flags['artifacts-dir'])
  }
  if (typeof flags.out === 'string') {
    const out = path.resolve(flags.out)
    return path.join(path.dirname(out), `${path.basename(out, path.extname(out))}-artifacts`)
  }
  const resolvedConfigPath = path.resolve(configPath)
  return path.join(
    path.dirname(resolvedConfigPath),
    `${path.basename(resolvedConfigPath, path.extname(resolvedConfigPath))}-artifacts`,
  )
}

function sanitizeFileBase(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'document'
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}

async function ensureJobOutputDirectories(job: BatchJobConfig): Promise<void> {
  const out = job.flags?.out
  if (typeof out === 'string') {
    await mkdir(path.dirname(out), { recursive: true })
  }

  const outDir = job.flags?.['out-dir']
  if (typeof outDir === 'string') {
    await mkdir(outDir, { recursive: true })
  }
}

async function runBatchJob(
  command: string,
  positional: string[],
  flags: Record<string, string | boolean>,
): Promise<CliResult> {
  switch (command) {
    case 'capabilities':
      return buildCapabilitiesResult()
    case 'schema':
      return buildSchemaResult(positional)
    case 'help':
      return buildHelpResult(positional)
    case 'doctor':
      return buildDoctorResult(flags)
    case 'preflight':
      return buildPreflightResult(positional, flags)
    case 'export':
      return buildExportResult(positional, flags)
    case 'screenshot':
      return buildScreenshotResult(positional, flags)
    case 'charts':
      return buildChartsResult(positional, flags)
    default:
      return createFailureResult(command, {
        code: 'UNSUPPORTED_BATCH_COMMAND',
        message: `batch 不支持命令：${command}`,
        target: command,
        exitCode: 2,
      })
  }
}

async function writeJsonReport(filePath: string, payload: unknown): Promise<CliArtifact> {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  const fileStat = await stat(filePath)
  return { type: 'json', path: filePath, bytes: fileStat.size }
}

async function writeMarkdownReport(
  filePath: string,
  jobs: Array<{ index: number; name?: string; command: string; ok: boolean; code?: string }>,
): Promise<CliArtifact> {
  const lines = [
    '# MD Viewer 批量执行报告',
    '',
    '| 序号 | 名称 | 命令 | 状态 |',
    '| --- | --- | --- | --- |',
    ...jobs.map(job => `| ${job.index} | ${escapeTableCell(job.name ?? '-')} | ${job.command} | ${job.ok ? '通过' : `失败 ${job.code ?? ''}`.trim()} |`),
    '',
  ]
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, lines.join('\n'), 'utf8')
  const fileStat = await stat(filePath)
  return { type: 'markdown', path: filePath, bytes: fileStat.size }
}

function escapeTableCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, ' ')
}
