// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { brotliCompressSync } from 'node:zlib'

const appState = vi.hoisted(() => ({ root:'', packaged:true }))
vi.mock('electron', () => ({ app:{ getAppPath:()=>appState.root, get isPackaged(){return appState.packaged} } }))
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
const source = Buffer.from('export const PUBLIC_ASSET = 1;')
const packed = brotliCompressSync(source)
let entry: any
let api: typeof import('../rendererAssets')
let session: any
let handler: (request: Request) => Promise<Response>
const assetUrl = () => pathToFileURL(path.join(appState.root,'out/renderer/asset.js')).href
const request = (suffix = '', method = 'GET') => handler(new Request(assetUrl()+suffix,{method}))
const manifest = (value: unknown) => fs.writeFile(path.join(appState.root,'renderer-assets.json'),JSON.stringify(value))

beforeEach(async () => {
  vi.resetModules()
  appState.packaged = true
  appState.root = await fs.mkdtemp(path.join(os.tmpdir(),'mdv-renderer-assets-test-'))
  await fs.mkdir(path.join(appState.root,'out/renderer'),{recursive:true})
  await fs.writeFile(path.join(appState.root,'package.json'),JSON.stringify({rendererAssetFormat:1}))
  await fs.writeFile(path.join(appState.root,'out/renderer/asset.js.br'),packed)
  entry = {path:'out/renderer/asset.js',compressedPath:'out/renderer/asset.js.br',bytes:source.length,compressedBytes:packed.length,sha256:sha(source),compressedSha256:sha(packed)}
  await manifest({formatVersion:1,entries:[entry]})
  session = {protocol:{handle:vi.fn((_scheme,fn)=>{handler=fn})},fetch:vi.fn(async()=>new Response('PUBLIC_NATIVE'))}
  api = await import('../rendererAssets')
})
afterEach(async () => { await fs.rm(appState.root,{recursive:true,force:true}) })

describe('packaged renderer assets', () => {
  it('installs once per Session and delivers the exact verified bytes', async () => {
    api.registerRendererAssets(session);api.registerRendererAssets(session)
    expect(session.protocol.handle).toHaveBeenCalledTimes(1)
    const response = await request()
    expect(response.status).toBe(200)
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(Buffer.from(await response.arrayBuffer())).toEqual(source)
    expect(session.fetch).not.toHaveBeenCalled()
  })

  it.each([false,true])('does not intercept an ordinary uncompressed build (packaged=%s)', async packaged => {
    appState.packaged = packaged
    await fs.writeFile(path.join(appState.root,'package.json'),'{}')
    api.registerRendererAssets(session)
    expect(session.protocol.handle).not.toHaveBeenCalled()
  })

  it('does not silently downgrade an unsupported package marker', async () => {
    await fs.writeFile(path.join(appState.root,'package.json'),'{"rendererAssetFormat":2}')
    expect(()=>api.registerRendererAssets(session)).toThrow(api.RendererAssetError)
  })

  it('forwards the unchanged Request through the same Session', async () => {
    api.registerRendererAssets(session)
    const original = new Request(pathToFileURL(path.join(appState.root,'native.js')).href)
    expect(await (await handler(original)).text()).toBe('PUBLIC_NATIVE')
    expect(session.fetch).toHaveBeenCalledWith(original,{bypassCustomProtocolHandlers:true})
  })

  it.each(['?version=1','#anchor'])('rejects extra URL components: %s', async suffix => {
    api.registerRendererAssets(session)
    expect((await request(suffix)).status).toBe(400)
    expect(session.fetch).not.toHaveBeenCalled()
  })

  it('rejects non-GET mapped requests', async () => {
    api.registerRendererAssets(session)
    expect((await request('','POST')).status).toBe(400)
  })

  it.each([
    ['duplicate',(e: any)=>[e,e]],
    ['traversal',(e: any)=>[{...e,path:'out/renderer/../asset.js'}]],
    ['empty segment',(e: any)=>[{...e,path:'out/renderer//asset.js'}]],
    ['absolute path',(e: any)=>[{...e,path:'/out/renderer/asset.js'}]],
    ['wrong physical path',(e: any)=>[{...e,compressedPath:'outside.br'}]],
    ['output limit',(e: any)=>[{...e,bytes:24*1024*1024+1}]],
    ['input limit',(e: any)=>[{...e,compressedBytes:16*1024*1024+1}]],
    ['invalid digest',(e: any)=>[{...e,sha256:'z'.repeat(64)}]],
    ['empty',()=>[]],
    ['count',()=>Array.from({length:1025},()=>({}))],
  ] as const)('fails closed on manifest %s', async (_name,mutate) => {
    await manifest({formatVersion:1,entries:mutate(entry)})
    api.registerRendererAssets(session)
    const response = await request()
    expect(response.status).toBe(500)
    expect(await response.text()).not.toContain('PUBLIC_ASSET')
    expect(session.fetch).not.toHaveBeenCalled()
  })

  it.each(['compressed','decoded','length','decompression-limit'])('rejects %s integrity failure', async kind => {
    if(kind==='compressed') await fs.writeFile(path.join(appState.root,entry.compressedPath),Buffer.alloc(packed.length))
    if(kind==='decoded') entry.sha256='0'.repeat(64)
    if(kind==='length') entry.compressedBytes++
    if(kind==='decompression-limit') entry.bytes=1
    await manifest({formatVersion:1,entries:[entry]})
    api.registerRendererAssets(session)
    expect((await request()).status).toBe(500)
  })

  it('rejects missing/symlink files and recovers after fixture repair', async () => {
    const file = path.join(appState.root,entry.compressedPath)
    api.registerRendererAssets(session)
    await fs.unlink(file)
    expect((await request()).status).toBe(500)
    const other = path.join(appState.root,'fixture-copy.br')
    await fs.writeFile(other,packed);await fs.symlink(other,file)
    expect((await request()).status).toBe(500)
    await fs.unlink(file);await fs.writeFile(file,packed)
    expect((await request()).status).toBe(200)
  })

  it('rejects missing manifests rather than falling back, then permits a repaired next task', async () => {
    api.registerRendererAssets(session)
    await fs.unlink(path.join(appState.root,'renderer-assets.json'))
    const first = api.watchRendererAssetFailures(session)
    await expect(first.race(request())).rejects.toBeInstanceOf(api.RendererAssetError)
    first.dispose()
    await manifest({formatVersion:1,entries:[entry]})
    const next = api.watchRendererAssetFailures(session)
    expect((await next.race(request())).status).toBe(200)
    next.dispose()
  })

  it('propagates an asset failure without waiting for the normal render deadline', async () => {
    api.registerRendererAssets(session)
    const observer = api.watchRendererAssetFailures(session)
    const pending = observer.race(new Promise<never>(()=>{}))
    const rejected = expect(pending).rejects.toBeInstanceOf(api.RendererAssetError)
    await fs.unlink(path.join(appState.root,entry.compressedPath))
    expect((await request()).status).toBe(500)
    await rejected
    observer.dispose()
  })

  it('does not deliver a late request failure to the next operation or another Session', async () => {
    api.registerRendererAssets(session)
    await fs.unlink(path.join(appState.root,entry.compressedPath))
    const first = api.watchRendererAssetFailures(session)
    const oldRequest = request()
    first.dispose()
    const next = api.watchRendererAssetFailures(session)
    const otherSession: any = {protocol:{handle:vi.fn()},fetch:vi.fn()}
    api.registerRendererAssets(otherSession)
    const other = api.watchRendererAssetFailures(otherSession)
    expect((await oldRequest).status).toBe(500)
    expect(await next.race(Promise.resolve('next'))).toBe('next')
    expect(await other.race(Promise.resolve('other'))).toBe('other')
    next.dispose();other.dispose()
  })
})
