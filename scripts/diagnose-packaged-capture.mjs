import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

const root = path.resolve(import.meta.dirname, '..')
const output = process.env.MD_VIEWER_CAPTURE_DIAGNOSTICS_DIR
if (!output) throw new Error('Explicit capture diagnostic output directory required')
await fs.mkdir(output, { recursive: true })
const packageArch = process.env.MD_VIEWER_PACKAGE_ARCH?.trim() || process.arch
const executable = process.platform === 'darwin'
  ? path.join(root, `dist/staged/${packageArch === 'x64' ? 'mac' : `mac-${packageArch}`}/MD Viewer.app/Contents/MacOS/MD Viewer`)
  : path.join(root, 'dist/staged/linux-unpacked/md-viewer')
const fixture = path.join(root, 'e2e/fixtures/shown-source.md')

async function observe(mode) {
  const directory = await fs.mkdtemp(path.join(output, `${mode}-`))
  const profile = path.join(directory, 'profile')
  const image = path.join(directory, 'body.png')
  const child = spawn(executable, ['--inspect-brk=0', `--user-data-dir=${profile}`, 'screenshot', fixture, '--selector', '.markdown-body', '--out', image, '--json'], {
    env: { ...process.env, NODE_OPTIONS: '', ELECTRON_DISABLE_SANDBOX: '1', MD_VIEWER_DOCX_AUTOSTART: '0', MD_VIEWER_SKIP_RESTORE: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = '', stderr = '', socket, attached = false
  const timeout = setTimeout(() => child.kill('SIGTERM'), 90_000)
  let instrumentationError
  async function attach(url) {
    socket = new WebSocket(url)
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }) })
    let id = 0
    const pending = new Map()
    let pause
    const paused = new Promise(resolve => { pause = resolve })
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data)
      if (message.method === 'Debugger.paused') pause()
      if (message.id && pending.has(message.id)) {
        const { resolve, reject } = pending.get(message.id)
        pending.delete(message.id)
        message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result)
      }
    })
    const call = (method, params = {}) => new Promise((resolve, reject) => { const requestId = ++id; pending.set(requestId, { resolve, reject }); socket.send(JSON.stringify({ id: requestId, method, params })) })
    await call('Runtime.enable')
    await call('Debugger.enable')
    await call('Runtime.runIfWaitingForDebugger')
    await paused
    const expression = `(() => {
      process.argv = process.argv.filter(arg => arg !== '--inspect-brk=0');
      const { app } = process.getBuiltinModule('module').createRequire(${JSON.stringify(path.join(root, 'package.json'))})('electron');
      const mode = ${JSON.stringify(mode)};
      if (mode === 'software') app.disableHardwareAcceleration();
      app.on('browser-window-created', (_event, window) => {
        const contents = window.webContents;
        contents.on('render-process-gone', (_event, details) => console.error('CAPTURE_RENDERER_EXIT', JSON.stringify(details)));
        const capture = contents.capturePage.bind(contents);
        contents.capturePage = async (...args) => {
          if (mode === 'visible') { window.showInactive(); await new Promise(resolve => setTimeout(resolve, 200)); }
          const dom = await contents.executeJavaScript('({ ready: document.readyState, width: innerWidth, height: innerHeight, bodyWidth: document.body.scrollWidth, bodyHeight: document.body.scrollHeight, markdown: !!document.querySelector(".markdown-body"), svgs: document.querySelectorAll("svg").length, dpr: devicePixelRatio })').catch(error => ({ error: error.message }));
          console.error('CAPTURE_OBSERVATION', JSON.stringify({ mode, versions: process.versions, visible: window.isVisible(), minimized: window.isMinimized(), bounds: window.getBounds(), contentBounds: window.getContentBounds(), captureArguments: args, preferences: contents.getLastWebPreferences(), gpu: app.getGPUFeatureStatus(), dom }));
          try { const result = await capture(...args); console.error('CAPTURE_RESULT', JSON.stringify({ empty: result.isEmpty(), size: result.getSize(), bytes: result.toPNG().length })); return result; }
          catch (error) { console.error('CAPTURE_ERROR', error.stack); throw error; }
        };
      });
    })()`
    const result = await call('Runtime.evaluate', { expression, returnByValue: true })
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
    await call('Debugger.resume')
    socket.close()
  }
  child.stdout.on('data', data => { stdout += data })
  child.stderr.on('data', data => {
    stderr += data
    const match = stderr.match(/Debugger listening on (ws:\/\/[^\s]+)/)
    if (match && !attached) {
      attached = true
      attach(match[1]).catch(error => { instrumentationError = error.stack; child.kill('SIGTERM'); socket?.close() })
    }
  })
  const completion = await new Promise(resolve => {
    child.once('error', error => resolve({ error: error.message }))
    child.once('close', (code, signal) => resolve({ code, signal }))
  })
  clearTimeout(timeout)
  socket?.close()
  await fs.writeFile(path.join(directory, 'stdout.json'), stdout)
  await fs.writeFile(path.join(directory, 'stderr.log'), stderr)
  const png = await fs.readFile(image).catch(() => null)
  const result = { mode, ...completion, inspectorAttached: attached, instrumentationError, pngBytes: png?.length ?? 0, output: path.relative(output, directory), temporaryDirectoryBase: os.tmpdir() }
  await fs.writeFile(path.join(directory, 'result.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result))
  return result
}

const results = []
for (const mode of ['baseline', 'software', 'visible']) results.push(await observe(mode))
await fs.writeFile(path.join(output, 'summary.json'), JSON.stringify(results, null, 2))
