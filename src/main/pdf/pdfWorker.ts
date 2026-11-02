import { app, BrowserWindow } from 'electron'
import { createHash } from 'node:crypto'
import { lstat, readFile, realpath, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { PDFDocument } from 'pdf-lib'
import { mergePdfParts, validatePdfParts } from './pdfMerge'
import type { PdfFailureCode, PdfLayout, PdfWorkerRequest } from './pdfExport'

const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex')
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
const SHA = /^[a-f0-9]{64}$/

class WorkerFailure extends Error {
  constructor(readonly code: PdfFailureCode) { super(code) }
}

function validRequest(value: unknown, jobId: string): value is PdfWorkerRequest {
  if (!value || typeof value !== 'object') return false
  const request = value as Record<string, unknown>
  if (request.jobId !== jobId || typeof request.snapshotSha256 !== 'string' || !SHA.test(request.snapshotSha256)) return false
  if (request.operation === 'merge') return Array.isArray(request.parts) && request.parts.length > 0 && typeof request.title === 'string'
  if (request.operation !== 'print') return false
  if (request.layoutSha256 !== undefined && (typeof request.layoutSha256 !== 'string' || !SHA.test(request.layoutSha256))) return false
  if (request.range === undefined) return request.layoutSha256 === undefined
  if (!request.range || typeof request.range !== 'object' || request.layoutSha256 === undefined) return false
  const { start, end } = request.range as { start?: number; end?: number }
  return Number.isSafeInteger(start) && Number.isSafeInteger(end) && Number(start) >= 1 &&
    Number(end) >= Number(start) && Number(end) - Number(start) < 16
}

async function readOwnedFile(directory: string, name: string): Promise<Buffer> {
  const file = path.join(directory, name)
  const info = await lstat(file)
  if (!info.isFile() || info.isSymbolicLink() || path.dirname(await realpath(file)) !== directory) {
    throw new WorkerFailure('snapshot')
  }
  return readFile(file)
}

const READY_SCRIPT = String.raw`(async () => {
  await document.fonts.ready;
  const images = await Promise.all(Array.from(document.images, image => image.decode().then(() => true, () => false)));
  const formulaDeadline = Date.now() + 5000;
  while (Array.from(document.querySelectorAll('.katex')).some(node => !node.querySelector('math, mrow, .katex-html')) && Date.now() < formulaDeadline) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  await new Promise(resolve => setTimeout(resolve, 100));
  const box = node => {
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    return [rect.x, rect.y, rect.width, rect.height, style.fontFamily, style.fontSize, style.lineHeight];
  };
  const stableCss = Array.from(document.querySelectorAll('style, [style]')).every(node => {
    const css = node.tagName.toLowerCase() === 'style' ? node.textContent : node.getAttribute('style');
    return !/@import\s/i.test(css || '') && Array.from((css || '').matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\)/gi)).every(match => {
      const url = (match[1] ?? match[2] ?? match[3] ?? '').trim();
      return !url || url.startsWith('data:') || url.startsWith('#');
    });
  });
  return {
    layout: JSON.stringify([box(document.body), ...Array.from(document.querySelectorAll('.markdown-body > *, [id], a[name]'), box)]),
    ready: document.fonts.status === 'loaded' && Array.from(document.fonts).every(font => font.status !== 'error') && images.every(Boolean),
    stable: stableCss && !document.querySelector('iframe, object, embed, video, audio, canvas') &&
      Array.from(document.querySelectorAll('img, image, link[rel=stylesheet]')).every(node => {
        const url = node.currentSrc || node.getAttribute('src') || node.getAttribute('href') || node.getAttribute('xlink:href') || '';
        return !url || url.startsWith('data:') || url.startsWith('#');
      })
  };
})()`

export async function runPdfWorker(): Promise<void> {
  const jobId = process.argv.find(arg => arg.startsWith('--md-viewer-pdf-helper='))?.split('=')[1] ?? ''
  const profile = process.argv.find(arg => arg.startsWith('--user-data-dir='))?.slice('--user-data-dir='.length) ?? ''
  if (!process.send || !process.connected || !UUID.test(jobId) || !path.isAbsolute(profile) ||
      !/^profile-[a-f0-9-]{36}$/.test(path.basename(profile)) ||
      !/^md-viewer-pdf-[a-zA-Z0-9]+$/.test(path.basename(path.dirname(profile)))) {
    app.exit(2)
    return
  }
  app.setPath('userData', profile)
  app.setPath('sessionData', profile)
  if (process.platform === 'darwin') app.setActivationPolicy('prohibited')
  process.once('disconnect', () => app.exit(1))
  process.once('SIGTERM', () => app.exit(1))
  const finish = (message: Record<string, unknown>, code: number): void => {
    if (!process.connected) return app.exit(code)
    process.send!({ ...message, jobId }, undefined, undefined, () => app.exit(code))
  }

  try {
    const rawDirectory = path.dirname(profile)
    const info = await lstat(rawDirectory)
    const profileInfo = await lstat(profile)
    if (!info.isDirectory() || info.isSymbolicLink() || !profileInfo.isDirectory() || profileInfo.isSymbolicLink() ||
        (process.platform !== 'win32' && ((info.mode & 0o077) !== 0 || (profileInfo.mode & 0o077) !== 0 || info.uid !== process.getuid?.()))) {
      throw new WorkerFailure('snapshot')
    }
    const directory = await realpath(rawDirectory)
    await app.whenReady()
    let received = false
    process.on('message', (message: unknown) => {
      if (received || !validRequest(message, jobId)) {
        finish({ type: 'failure', code: 'snapshot' }, 1)
        return
      }
      received = true
      void execute(message, directory, jobId).then(
        result => finish({ type: 'complete', ...result }, 0),
        error => finish({ type: 'failure', code: error instanceof WorkerFailure ? error.code : 'snapshot' }, 1),
      )
    })
    process.send!({ type: 'ready', jobId })
  } catch {
    finish({ type: 'failure', code: 'snapshot' }, 1)
  }
}

async function execute(request: PdfWorkerRequest, directory: string, jobId: string): Promise<Record<string, unknown>> {
  const html = await readOwnedFile(directory, 'document.html')
  if (sha256(html) !== request.snapshotSha256) throw new WorkerFailure('snapshot')
  let bytes: Uint8Array
  let file: string
  let layout: PdfLayout = { layoutSha256: request.snapshotSha256, selfContained: true }
  if (request.operation === 'merge') {
    try {
      validatePdfParts(request.parts)
      bytes = await mergePdfParts(request.parts, async part => {
        const data = await readOwnedFile(directory, part.file)
        if (sha256(data) !== part.sha256) throw new WorkerFailure('merge')
        return data
      }, request.title)
      file = 'merged.pdf'
    } catch {
      throw new WorkerFailure('merge')
    }
  } else {
    const window = new BrowserWindow({
      show: false,
      width: 800,
      height: 600,
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webviewTag: false },
    })
    const documentUrl = pathToFileURL(path.join(directory, 'document.html')).href
    let remoteRequested = false
    let nativePrinting = false
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', event => event.preventDefault())
    window.webContents.on('will-attach-webview', event => event.preventDefault())
    window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    window.webContents.session.setPermissionCheckHandler(() => false)
    window.webContents.session.on('will-download', event => event.preventDefault())
    window.webContents.session.webRequest.onBeforeRequest((details, callback) => {
      if (details.url === documentUrl || details.url.startsWith('data:')) return callback({})
      if (/^https?:/.test(details.url) && details.resourceType !== 'mainFrame' && details.resourceType !== 'subFrame') {
        remoteRequested = true
        return callback({ cancel: Boolean(request.range) })
      }
      remoteRequested = true
      callback({ cancel: true })
    })
    window.webContents.once('render-process-gone', () => {
      if (nativePrinting) process.send?.({ type: 'failure', code: 'crashed', jobId }, undefined, undefined, () => app.exit(1))
      else app.exit(1)
    })
    try {
      await window.loadFile(path.join(directory, 'document.html'))
      window.webContents.debugger.attach('1.3')
      await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { media: 'print' })
      const state = await window.webContents.executeJavaScript(READY_SCRIPT) as { layout: string; ready: boolean; stable: boolean }
      layout = { layoutSha256: sha256(state.layout), selfContained: state.ready && state.stable && !remoteRequested }
      if (request.range && !layout.selfContained) throw new WorkerFailure('remote')
      if (request.layoutSha256 && request.layoutSha256 !== layout.layoutSha256) throw new WorkerFailure('layout')
      process.send?.({ type: 'part', jobId, ...layout })
      nativePrinting = true
      try {
        const margin = 10 / 25.4
        bytes = await window.webContents.printToPDF({
          pageSize: 'A4',
          margins: { top: margin, bottom: margin, left: margin, right: margin },
          printBackground: true,
          preferCSSPageSize: false,
          ...(request.range ? { pageRanges: `${request.range.start}-${request.range.end}` } : {}),
        })
      } catch (error) {
        layout.selfContained &&= !remoteRequested
        process.send?.({ type: 'part', jobId, ...layout })
        throw new WorkerFailure(error instanceof Error && error.message === 'Failed to generate PDF: Page range exceeds page count' ? 'range' : 'printing')
      }
      layout.selfContained &&= !remoteRequested
      nativePrinting = false
      file = request.range ? `part-${request.range.start}-${request.range.end}.pdf` : 'whole.pdf'
    } finally {
      if (!window.isDestroyed()) window.destroy()
    }
  }
  const parsed = await PDFDocument.load(bytes)
  const pages = parsed.getPageCount()
  if (pages < 1) throw new WorkerFailure('printing')
  try {
    await writeFile(path.join(directory, file), bytes, { flag: 'wx', mode: 0o600 })
  } catch {
    throw new WorkerFailure('save')
  }
  return { file, pages, bytes: bytes.length, sha256: sha256(bytes), ...layout }
}
