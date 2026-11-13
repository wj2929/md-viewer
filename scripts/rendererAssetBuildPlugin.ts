import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { build } from 'esbuild'
import { init, parse } from 'es-module-lexer'
import type { Plugin } from 'vite'

const sha256 = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const normalizeModuleId = (id: string) => path.normalize(id.replace(/\\/g, '/')).replace(/\\/g, '/')
const fontEntrySha256 = '3a934398962a0289fa451776640208d406b35b375e7761bd865b574de2f46e25'
const nativeEntries = new Set([
  'src/renderer/src/workers/searchWorker.ts',
  'src/renderer/src/workers/attachmentSqlWorker.ts',
  'src/renderer/src/workers/attachmentSearchWorker.ts',
])

export function rendererAssetBuildPlugins(projectRoot: string): {
  renderer: Plugin
  workers: () => Plugin[]
} {
  const fontEntry = path.join(projectRoot, 'node_modules/@excalidraw/excalidraw/dist/prod/subset-worker.chunk.js')
  const workerOutputs = new Map<string, string>()
  let fontReference = ''
  let fontModuleCount = 0

  return {
    renderer: {
      name: 'native-font-subset-worker',
      apply: 'build',
      enforce: 'pre',
      async buildStart() {
        workerOutputs.clear()
        fontModuleCount = 0
        const manifest = JSON.parse(readFileSync(path.join(projectRoot, 'node_modules/@excalidraw/excalidraw/package.json'), 'utf8'))
        if (manifest.version !== '0.18.1' || sha256(readFileSync(fontEntry)) !== fontEntrySha256) {
          this.error('Excalidraw font Worker input changed; review the independent build before packaging')
        }
        const output = await build({
          absWorkingDir: projectRoot,
          entryPoints: [fontEntry],
          bundle: true,
          write: false,
          format: 'esm',
          platform: 'browser',
          target: 'chrome156',
          minify: true,
          legalComments: 'eof',
          metafile: true,
        })
        const code = output.outputFiles[0].text
        await init
        if (parse(code)[0].some(entry => entry.d !== -2)) this.error('Font Worker has external imports')
        for (const notice of ['Copyright (c) 2014 ecomfe', 'Copyright (c) 2019 Ebrahim Byagowi']) {
          if (!code.includes(notice)) this.error('Font Worker license text missing')
        }
        fontReference = this.emitFile({ type: 'asset', name: 'font-subset-worker.js', source: code })
      },
      load(id) {
        if (normalizeModuleId(id) !== normalizeModuleId(fontEntry)) return null
        fontModuleCount++
        return `export const WorkerUrl = new URL(import.meta.ROLLUP_FILE_URL_${fontReference});`
      },
      generateBundle: { order: 'post', handler(_options, bundle) {
        if (fontModuleCount !== 1) this.error('Expected exactly one font Worker URL module')
        workerOutputs.set('node_modules/@excalidraw/excalidraw/dist/prod/subset-worker.chunk.js', this.getFileName(fontReference))
        const nativeWorkers = [...workerOutputs].sort(([a], [b]) => a.localeCompare(b)).map(([source, file]) => {
          const output = bundle[file]
          if (!output || output.type !== 'asset') this.error(`Missing native Worker output: ${file}`)
          const bytes = Buffer.from(output.source)
          return { source, path: file, bytes: bytes.length, sha256: sha256(bytes) }
        })
        if (nativeWorkers.length !== nativeEntries.size + 1) this.error('Native Worker output closure incomplete')
        const fontModules = Object.values(bundle).filter(output => output.type === 'chunk' && output.facadeModuleId && normalizeModuleId(output.facadeModuleId) === normalizeModuleId(fontEntry))
        if (fontModules.length !== 1) this.error('Font Worker URL module missing from output graph')
        this.emitFile({
          type: 'asset',
          fileName: 'renderer-asset-roles.json',
          source: JSON.stringify({ formatVersion: 1, fontWorkerModule: fontModules[0].fileName, nativeWorkers }, null, 2) + '\n',
        })
      } },
    },
    workers: () => [{
      name: 'native-file-worker-audit',
      generateBundle(_options, bundle) {
        for (const output of Object.values(bundle)) {
          if (output.type !== 'chunk') continue
          const source = path.relative(projectRoot, output.facadeModuleId ?? '').split(path.sep).join('/')
          if (!output.isEntry || !nativeEntries.has(source) || output.imports.length || output.dynamicImports.length) {
            this.error(`Unreviewed or non-independent file Worker: ${source}`)
          }
          workerOutputs.set(source, output.fileName)
        }
      },
    }],
  }
}
