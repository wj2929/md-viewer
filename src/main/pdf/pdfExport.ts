import { spawn, type ChildProcess } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { access, chmod, copyFile, lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { app } from 'electron'
import type { CliArtifact } from '../cli/types'
import type { PdfPart } from './pdfMerge'

export interface PdfLayout {
  layoutSha256: string
  selfContained: boolean
}

export type PdfWorkerRequest = {
  jobId: string
  snapshotSha256: string
} & ({ operation: 'print'; range?: { start: number; end: number }; layoutSha256?: string } |
  { operation: 'merge'; parts: PdfPart[]; title: string })

export interface PdfWorkerResult extends PdfLayout {
  type: 'complete'
  jobId: string
  file: string
  sha256: string
  bytes: number
  pages: number
}

const FAILURE_MESSAGES = {
  startup: 'PDF 打印进程启动失败',
  snapshot: 'PDF 打印快照校验失败',
  resource: 'PDF 字体或图片尚未就绪',
  layout: 'PDF 分段布局发生变化，已停止导出',
  remote: 'PDF 包含未封存的外部资源，无法安全分段；请先将资源保存到本地',
  printing: 'PDF 打印失败',
  range: 'PDF 打印页码超出范围',
  crashed: 'PDF 打印进程意外退出',
  merge: 'PDF 合并或链接校验失败',
  save: 'PDF 保存失败，原目标文件未被替换',
  timeout: 'PDF 导出超时，原目标文件未被替换',
  aborted: 'PDF 导出已取消',
} as const
export type PdfFailureCode = keyof typeof FAILURE_MESSAGES

export class PdfExportError extends Error {
  constructor(readonly code: PdfFailureCode, readonly layout?: PdfLayout) {
    super(FAILURE_MESSAGES[code])
  }
}

const STARTUP_TIMEOUT_MS = 15_000
const OPERATION_TIMEOUT_MS = 60_000
const TOTAL_TIMEOUT_MS = 180_000
const EXIT_IPC_DRAIN_MS = 1_000
const INITIAL_RANGE_SIZE = 16
let queue: Promise<unknown> = Promise.resolve()
const children = new Set<ChildProcess>()
let exitHandlerInstalled = false
let quitting = false

export function pdfSha256(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function checkActive(deadline: number, signal?: AbortSignal): void {
  if (quitting || signal?.aborted) throw new PdfExportError('aborted')
  if (Date.now() >= deadline) throw new PdfExportError('timeout')
}

function isLayout(value: Record<string, unknown>): value is Record<string, unknown> & PdfLayout {
  return typeof value.layoutSha256 === 'string' && /^[a-f0-9]{64}$/.test(value.layoutSha256) &&
    typeof value.selfContained === 'boolean'
}

async function mainEntry(): Promise<string[]> {
  if (app.isPackaged) return []
  for (const candidate of [path.join(app.getAppPath(), 'out/main/index.js'), path.join(app.getAppPath(), 'index.js')]) {
    try {
      await access(candidate)
      return [candidate]
    } catch { /* 兼容源码启动与 out/main 作为 appPath 的测试启动。 */ }
  }
  throw new PdfExportError('startup')
}

async function runWorker(
  directory: string,
  request: PdfWorkerRequest,
  deadline: number,
  signal?: AbortSignal,
): Promise<PdfWorkerResult> {
  checkActive(deadline, signal)
  const profile = path.join(directory, `profile-${randomUUID()}`)
  await mkdir(profile, { mode: 0o700 })
  const entry = await mainEntry()
  checkActive(deadline, signal)
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(process.execPath, [...entry, `--md-viewer-pdf-helper=${request.jobId}`, `--user-data-dir=${profile}`], {
    env,
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    windowsHide: true,
  })
  children.add(child)

  return new Promise((resolve, reject) => {
    let result: PdfWorkerResult | undefined
    let failure: PdfExportError | undefined
    let layout: PdfLayout | undefined
    let ready = false
    let settled = false
    let exited = false
    let disconnected = false
    let exitCode: number | null = null
    let timer: ReturnType<typeof setTimeout>
    function settle(code: number | null): void {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      if (child.connected) child.disconnect()
      children.delete(child)
      if (failure) reject(failure)
      else if (quitting || signal?.aborted) reject(new PdfExportError('aborted'))
      else if (code === 0 && result) resolve(result)
      else reject(new PdfExportError(request.operation === 'merge' && ready ? 'merge' : layout ? 'crashed' : 'startup', layout))
    }
    const terminate = (error: PdfExportError): void => {
      failure ??= error
      if (settled) return
      if (exited || !child.pid) settle(exitCode)
      else child.kill('SIGKILL')
    }
    const armTimer = (ms: number): void => {
      clearTimeout(timer)
      timer = setTimeout(() => terminate(new PdfExportError('timeout')), Math.max(1, Math.min(ms, deadline - Date.now())))
    }
    const abort = (): void => terminate(new PdfExportError('aborted'))
    armTimer(STARTUP_TIMEOUT_MS)
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
    child.on('error', () => terminate(new PdfExportError('startup')))
    child.on('message', (message: unknown) => {
      if (settled || failure || !message || typeof message !== 'object') return
      const value = message as Record<string, unknown>
      if (value.jobId !== request.jobId) return terminate(new PdfExportError('snapshot'))
      if (value.type === 'ready' && !ready) {
        ready = true
        armTimer(OPERATION_TIMEOUT_MS)
        child.send(request, error => { if (error) terminate(new PdfExportError('startup')) })
      } else if (value.type === 'part' && ready && request.operation === 'print' && isLayout(value)) {
        layout = { layoutSha256: value.layoutSha256, selfContained: value.selfContained }
      } else if (value.type === 'complete' && ready && isLayout(value) &&
                 typeof value.file === 'string' && typeof value.sha256 === 'string' && /^[a-f0-9]{64}$/.test(value.sha256) &&
                 Number.isSafeInteger(value.pages) && Number(value.pages) > 0 &&
                 Number.isSafeInteger(value.bytes) && Number(value.bytes) > 0) {
        result = value as unknown as PdfWorkerResult
        if (exited) settle(exitCode)
      } else if (value.type === 'failure' && typeof value.code === 'string' && Object.hasOwn(FAILURE_MESSAGES, value.code)) {
        terminate(new PdfExportError(value.code as PdfFailureCode, layout))
      } else {
        terminate(new PdfExportError('snapshot'))
      }
    })
    child.once('exit', code => {
      exited = true
      exitCode = code
      // 退出后只给在途 IPC 有界排空时间，不再依赖 stdio 的 close 事件。
      if (failure || result || disconnected || quitting || signal?.aborted) settle(code)
      else {
        clearTimeout(timer)
        timer = setTimeout(() => settle(code), Math.max(1, Math.min(EXIT_IPC_DRAIN_MS, deadline - Date.now())))
      }
    })
    child.once('disconnect', () => {
      disconnected = true
      if (!result) failure ??= new PdfExportError(request.operation === 'merge' && ready ? 'merge' : layout ? 'crashed' : 'startup', layout)
      if (exited) settle(exitCode)
    })
    child.once('close', settle)
  })
}

async function verifyResult(directory: string, result: PdfWorkerResult, expectedFile: string): Promise<string> {
  if (result.file !== expectedFile) throw new PdfExportError('snapshot')
  const file = path.join(directory, expectedFile)
  const info = await lstat(file)
  if (!info.isFile() || info.isSymbolicLink() || info.size !== result.bytes ||
      path.dirname(await realpath(file)) !== await realpath(directory) ||
      pdfSha256(await readFile(file)) !== result.sha256) throw new PdfExportError('snapshot')
  return file
}

async function commitPdf(source: string, outputPath: string, result: PdfWorkerResult, deadline: number, signal?: AbortSignal): Promise<void> {
  const temporary = path.join(path.dirname(outputPath), `.mdv-pdf-${randomUUID()}.tmp`)
  let created = false
  try {
    checkActive(deadline, signal)
    await copyFile(source, temporary, constants.COPYFILE_EXCL)
    created = true
    await chmod(temporary, 0o600)
    if (pdfSha256(await readFile(temporary)) !== result.sha256) throw new PdfExportError('save')
    checkActive(deadline, signal)
    await rename(temporary, outputPath)
  } catch (error) {
    if (error instanceof PdfExportError) throw error
    throw new PdfExportError('save')
  } finally {
    if (created) await rm(temporary, { force: true }).catch(() => undefined)
  }
}

async function performExport(outputPath: string, html: string, title: string, signal?: AbortSignal): Promise<CliArtifact> {
  const deadline = Date.now() + TOTAL_TIMEOUT_MS
  checkActive(deadline, signal)
  let directory: string | undefined
  try {
    directory = await mkdtemp(path.join(tmpdir(), 'md-viewer-pdf-'))
    await chmod(directory, 0o700)
    await writeFile(path.join(directory, 'document.html'), html, { mode: 0o600, flag: 'wx' })
    const jobId = randomUUID()
    const snapshotSha256 = pdfSha256(html)
    let result: PdfWorkerResult
    let source: string
    try {
      result = await runWorker(directory, { operation: 'print', jobId, snapshotSha256 }, deadline, signal)
      source = await verifyResult(directory, result, 'whole.pdf')
    } catch (error) {
      if (!(error instanceof PdfExportError) || !['printing', 'crashed'].includes(error.code)) throw error
      if (!error.layout?.selfContained) throw new PdfExportError('remote')
      const layoutSha256 = error.layout.layoutSha256
      const parts: PdfPart[] = []
      let start = 1
      let rangeSize = INITIAL_RANGE_SIZE
      for (;;) {
        checkActive(deadline, signal)
        const end = start + rangeSize - 1
        let part: PdfWorkerResult
        try {
          part = await runWorker(directory, { operation: 'print', jobId, snapshotSha256, layoutSha256, range: { start, end } }, deadline, signal)
        } catch (partError) {
          if (partError instanceof PdfExportError && partError.code === 'range' && parts.length > 0) break
          if (partError instanceof PdfExportError && ['printing', 'crashed'].includes(partError.code) && rangeSize > 1) {
            rangeSize = Math.max(1, Math.floor(rangeSize / 2))
            continue
          }
          throw partError
        }
        if (!part.selfContained || part.layoutSha256 !== layoutSha256 || part.pages > rangeSize) throw new PdfExportError('layout')
        const file = `part-${start}-${end}.pdf`
        await verifyResult(directory, part, file)
        parts.push({ start, end: start + part.pages - 1, pages: part.pages, file, sha256: part.sha256 })
        start += part.pages
        if (part.pages < rangeSize) break
      }
      result = await runWorker(directory, { operation: 'merge', jobId, snapshotSha256, parts, title }, deadline, signal)
      if (result.pages !== start - 1) throw new PdfExportError('merge')
      source = await verifyResult(directory, result, 'merged.pdf')
    }
    await commitPdf(source, outputPath, result, deadline, signal)
    return { type: 'pdf', path: outputPath, bytes: result.bytes }
  } catch (error) {
    if (error instanceof PdfExportError) throw error
    throw new PdfExportError('snapshot')
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }).catch(() => undefined)
  }
}

export function exportPdfSnapshot(outputPath: string, html: string, title: string, signal?: AbortSignal): Promise<CliArtifact> {
  if (!exitHandlerInstalled) {
    app.once('will-quit', () => {
      quitting = true
      for (const ownedChild of children) ownedChild.kill('SIGKILL')
    })
    exitHandlerInstalled = true
  }
  const task = queue.then(() => performExport(outputPath, html, title, signal))
  queue = task.catch(() => undefined)
  if (!signal) return task
  // 关闭排队窗口时立即返回取消；已排队回调出队后只做 aborted 检查，不启动 helper。
  return new Promise((resolve, reject) => {
    const abort = (): void => reject(new PdfExportError('aborted'))
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
    task.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}
