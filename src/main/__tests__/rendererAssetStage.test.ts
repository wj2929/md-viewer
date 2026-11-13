// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { createPackage, listPackage } from '@electron/asar'

vi.mock('@electron/asar', async importOriginal => {
  const actual = await importOriginal<typeof import('@electron/asar')>()
  return { ...actual, listPackage: vi.fn(actual.listPackage) }
})
// @ts-expect-error build helpers are Node.js ESM scripts
import { prepareRendererAssets, inspectRendererAssets, listRegularFiles } from '../../../scripts/prepare-renderer-assets.mjs'
// @ts-expect-error build helpers are Node.js ESM scripts
import { inspectArchiveInputs } from '../../../scripts/inspect-archive-inputs.mjs'

let root: string
let stage: string
const sha = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex')
async function put(name: string, value: string | Buffer): Promise<void> {
  const file = path.join(root,name)
  await fs.mkdir(path.dirname(file),{recursive:true})
  await fs.writeFile(file,value)
}
async function fileEntry(name: string): Promise<any> {
  const bytes = await fs.readFile(path.join(stage,name))
  return {path:name,archivePath:name,bytes:bytes.length,sha256:sha(bytes),packageRoot:'node_modules/demo',packageVersion:'1.0.0'}
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(),'mdv-asset-stage-test-'))
  stage = path.join(root,'stage')
  await put('out/main/index.js','// PUBLIC_MAIN')
  await put('out/renderer/index.html','<!doctype html><h1>PUBLIC_PAGE</h1>')
  await put('out/renderer/assets/page.js','export const PUBLIC_PAGE = true')
  await put('out/renderer/assets/font-url.js','export const WorkerUrl = new URL("./font.js",import.meta.url)')
  const worker = 'self.onmessage = () => {}'
  await put('out/renderer/assets/font.js',worker)
  await put('out/renderer/renderer-asset-roles.json',JSON.stringify({formatVersion:1,fontWorkerModule:'assets/font-url.js',nativeWorkers:[{source:'font-fixture',path:'assets/font.js',bytes:Buffer.byteLength(worker),sha256:sha(worker)}]}))
  await fs.cp(path.join(root,'out'),path.join(stage,'out'),{recursive:true})
  await put('stage/package.json','{"name":"public-fixture","version":"1.0.0","main":"out/main/index.js"}')
  await put('stage/node_modules/demo/package.json','{"name":"demo","version":"1.0.0"}')
  await put('stage/node_modules/demo/index.js','module.exports = "PUBLIC_DEMO"')
  await put('stage/node_modules/demo/index.js.map','PUBLIC_MAP')
  await put('stage/node_modules/demo/retained.js.map','PUBLIC_RETAINED_MAP')
  await put('stage/node_modules/demo/LICENSE','PUBLIC_LICENSE')
  const notices = 'PUBLIC_DISTRIBUTION_COMMENTS'
  await put('config/production-distribution-comments.txt',notices)
  await put('config/package-pruning-audit.json',JSON.stringify({formatVersion:1,removed:[await fileEntry('node_modules/demo/index.js.map')],retainedMaps:[await fileEntry('node_modules/demo/retained.js.map')],legalFiles:[await fileEntry('node_modules/demo/LICENSE')],notices:{file:'THIRD_PARTY_DISTRIBUTION_COMMENTS.txt',bytes:Buffer.byteLength(notices),sha256:sha(notices)}}))
})
afterEach(async () => { await fs.rm(root,{recursive:true,force:true}) })

describe('stage-only renderer asset preparation', () => {
  it('keeps ordinary out/native Workers and produces deterministic verified Brotli', async () => {
    const second = path.join(root,'second-stage')
    await fs.cp(stage,second,{recursive:true})
    await prepareRendererAssets(root,stage)
    await prepareRendererAssets(root,second)
    expect(await fs.readFile(path.join(stage,'renderer-assets.json'))).toEqual(await fs.readFile(path.join(second,'renderer-assets.json')))
    expect(await fs.readFile(path.join(stage,'out/renderer/assets/page.js.br'))).toEqual(await fs.readFile(path.join(second,'out/renderer/assets/page.js.br')))
    expect(await fs.readFile(path.join(root,'out/renderer/assets/page.js'),'utf8')).toContain('PUBLIC_PAGE')
    expect(await fs.readFile(path.join(stage,'out/renderer/assets/font.js'),'utf8')).toContain('onmessage')
    await expect(fs.access(path.join(stage,'out/renderer/assets/page.js'))).rejects.toThrow()
    expect(await inspectRendererAssets(root,stage)).toEqual({compressedFiles:2,nativeWorkers:1,retainedLegalFiles:1})
  })

  it.each(['hash','version','notices'])('aborts before pruning on qualification drift: %s', async kind => {
    if(kind==='hash') await put('stage/node_modules/demo/index.js.map','CHANGED_MAP')
    if(kind==='version') await put('stage/node_modules/demo/package.json','{"name":"demo","version":"2.0.0"}')
    if(kind==='notices') await put('config/production-distribution-comments.txt','CHANGED_NOTICES')
    await expect(prepareRendererAssets(root,stage)).rejects.toThrow()
    expect(await fs.readFile(path.join(stage,'node_modules/demo/LICENSE'),'utf8')).toBe('PUBLIC_LICENSE')
    await expect(fs.access(path.join(stage,'node_modules/demo/index.js.map'))).resolves.toBeUndefined()
    await expect(fs.access(path.join(stage,'renderer-assets.json'))).rejects.toThrow()
  })

  it.each(['raw fallback','extra payload','missing payload','notice','native identity'])('rejects altered staged closure: %s', async kind => {
    await prepareRendererAssets(root,stage)
    if(kind==='raw fallback') await put('stage/out/renderer/assets/page.js','export const PUBLIC_PAGE = true')
    if(kind==='extra payload') await put('stage/out/renderer/extra.js.br','EXTRA')
    if(kind==='missing payload') await fs.unlink(path.join(stage,'out/renderer/assets/page.js.br'))
    if(kind==='notice') await put('stage/THIRD_PARTY_DISTRIBUTION_COMMENTS.txt','ALTERED')
    if(kind==='native identity') await put('stage/out/renderer/assets/font.js','ALTERED_WORKER')
    await expect(inspectRendererAssets(root,stage)).rejects.toThrow()
  })

  it('rejects native Worker role duplication', async () => {
    const file = path.join(stage,'out/renderer/renderer-asset-roles.json')
    const roles = JSON.parse(await fs.readFile(file,'utf8'))
    roles.nativeWorkers.push(roles.nativeWorkers[0])
    await fs.writeFile(file,JSON.stringify(roles))
    await expect(prepareRendererAssets(root,stage)).rejects.toThrow('Invalid native Worker role')
  })

  it.each(['valid','windows enumeration','extra','missing','corrupt'])('checks the exact physical ASAR projection: %s', async kind => {
    await prepareRendererAssets(root,stage)
    const files: string[] = await listRegularFiles(stage)
    const projection = []
    const input = path.join(root,'archive-input')
    for (const name of files) {
      const bytes = await fs.readFile(path.join(stage,name))
      projection.push({source:name,path:name,sourceSha256:sha(bytes),sha256:sha(bytes),bytes:bytes.length})
      await fs.mkdir(path.dirname(path.join(input,name)),{recursive:true})
      await fs.writeFile(path.join(input,name),bytes)
    }
    await put('stage/.expected-archive.json',JSON.stringify({formatVersion:1,files:projection}))
    await put('stage/.runtime-closure.json',JSON.stringify({packages:[{path:'node_modules/demo',version:'1.0.0'}]}))
    if(kind==='extra') await put('archive-input/extra.js','EXTRA')
    if(kind==='missing') await fs.unlink(path.join(input,'out/renderer/assets/page.js.br'))
    if(kind==='corrupt') await put('archive-input/node_modules/demo/index.js','CORRUPTED')
    const archive = path.join(root,'public.asar')
    await createPackage(input,archive)
    if (kind === 'windows enumeration') {
      const actual = await vi.importActual<typeof import('@electron/asar')>('@electron/asar')
      vi.mocked(listPackage).mockImplementationOnce((...args) => actual.listPackage(...args).map(name => name.replace(/\//g, '\\')))
    }
    if(kind==='valid' || kind==='windows enumeration') expect(await inspectArchiveInputs(root,stage,archive)).toMatchObject({physicalFiles:files.length,closurePackages:1,protectedLegalFiles:1})
    else await expect(inspectArchiveInputs(root,stage,archive)).rejects.toThrow()
  })
})
