// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { rendererAssetBuildPlugins } from '../../../scripts/rendererAssetBuildPlugin'

const root = path.resolve(import.meta.dirname, '../../..')
const fontEntry = path.join(root, 'node_modules/@excalidraw/excalidraw/dist/prod/subset-worker.chunk.js')
const error = (message: string): never => { throw new Error(message) }

function invoke(plugin: any, hook: string, context: any, ...args: any[]): any {
  const value = plugin[hook]
  return (typeof value === 'function' ? value : value.handler).call(context, ...args)
}

describe('native renderer Worker build', () => {
  const plugins = rendererAssetBuildPlugins(root)
  let fontAsset: any
  const context = {
    error,
    emitFile(asset: any) { fontAsset = asset; return 'font-reference' },
    getFileName() { return 'assets/font-worker.js' },
  }

  beforeAll(async () => {
    await invoke(plugins.renderer, 'buildStart', context)
  })

  it('builds the pinned independent Worker and retains legal text', () => {
    expect(fontAsset.type).toBe('asset')
    expect(fontAsset.name).toBe('font-subset-worker.js')
    expect(fontAsset.source).toContain('Copyright (c) 2014 ecomfe')
    expect(fontAsset.source).toContain('Copyright (c) 2019 Ebrahim Byagowi')
    expect(createHash('sha256').update(fontAsset.source).digest('hex')).toBe(
      'fdc7052f3cc4dd51468e322e2763eca19fe2c34ebd63bb153bfd289636d2c52a',
    )
  })

  it('replaces only the exact page module with a Rollup asset URL reference', () => {
    expect(invoke(plugins.renderer, 'load', context, fontEntry + '?worker')).toBeNull()
    expect(invoke(plugins.renderer, 'load', context, fontEntry.replace('subset-worker', 'subset-shared'))).toBeNull()
    expect(invoke(plugins.renderer, 'load', context, fontEntry)).toBe(
      'export const WorkerUrl = new URL(import.meta.ROLLUP_FILE_URL_font-reference);',
    )
  })

  it('rejects unreviewed or dependent file Workers', () => {
    const worker = plugins.workers()[0]
    const output = { type:'chunk', isEntry:true, fileName:'assets/worker.js', facadeModuleId:path.join(root,'src/renderer/src/workers/unknown.ts'), imports:[], dynamicImports:[] }
    expect(() => invoke(worker,'generateBundle',{error},{},{worker:output})).toThrow('Unreviewed')
    output.facadeModuleId = path.join(root,'src/renderer/src/workers/searchWorker.ts')
    expect(() => invoke(worker,'generateBundle',{error},{},{worker:{...output,imports:['page.js']}})).toThrow('non-independent')
  })

  it('requires all native outputs before emitting role metadata', () => {
    expect(() => invoke(plugins.renderer,'generateBundle',context,{},{})).toThrow('Missing native Worker output')
    const worker = plugins.workers()[0]
    const bundle: any = {
      'assets/font-worker.js': {type:'asset',source:fontAsset.source},
      'assets/font-url.js': {type:'chunk',facadeModuleId:fontEntry,fileName:'assets/font-url.js'},
    }
    for (const source of ['searchWorker','attachmentSqlWorker','attachmentSearchWorker']) {
      const fileName = `assets/${source}.js`
      invoke(worker,'generateBundle',{error},{},{worker:{type:'chunk',isEntry:true,fileName,facadeModuleId:path.join(root,`src/renderer/src/workers/${source}.ts`),imports:[],dynamicImports:[]}})
      bundle[fileName] = {type:'asset',source:'self.onmessage = () => {}'}
    }
    let metadata: any
    invoke(plugins.renderer,'generateBundle',{...context,emitFile(asset: any){metadata=JSON.parse(asset.source)}},{},bundle)
    expect(metadata.fontWorkerModule).toBe('assets/font-url.js')
    expect(metadata.nativeWorkers).toHaveLength(4)
    expect(new Set(metadata.nativeWorkers.map((worker: any)=>worker.path)).size).toBe(4)
  })
})
