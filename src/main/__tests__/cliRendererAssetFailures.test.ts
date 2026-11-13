// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

const state = vi.hoisted(() => ({root:'',mode:'ordinary',windows:[] as any[]}))
const assetMocks = vi.hoisted(() => {
  class AssetError extends Error {}
  return { AssetError, register:vi.fn(), dispose:vi.fn(), watch:vi.fn() }
})
vi.mock('../rendererAssets',()=>({
  RendererAssetError:assetMocks.AssetError,
  registerRendererAssets:assetMocks.register,
  watchRendererAssetFailures:assetMocks.watch,
}))
vi.mock('electron',()=>({
  app:{isReady:()=>true,getAppPath:()=>state.root},
  BrowserWindow:class {
    webContents={session:{},setZoomFactor:vi.fn()}
    loadFile=vi.fn(()=>state.mode==='asset'?new Promise<void>(()=>{}):Promise.reject(Error('PUBLIC_ORDINARY_FAILURE')))
    isDestroyed=()=>false
    destroy=vi.fn()
    constructor(){state.windows.push(this)}
  },
}))
const { renderMarkdownHeadless, captureMarkdownScreenshot } = await import('../cli/headlessRenderer')

beforeEach(async()=>{
  vi.clearAllMocks()
  state.mode='ordinary';state.windows=[]
  state.root=await fs.mkdtemp(path.join(os.tmpdir(),'mdv-headless-assets-test-'))
  await fs.mkdir(path.join(state.root,'out/renderer'),{recursive:true})
  await fs.writeFile(path.join(state.root,'out/renderer/server-render.html'),'<script type="module" src="./assets/serverRender-public.js"></script>')
  assetMocks.register.mockImplementation(()=>{})
  assetMocks.watch.mockImplementation(()=>({
    race:(operation:Promise<unknown>)=>state.mode==='asset'?Promise.race([operation,Promise.reject(new assetMocks.AssetError('PUBLIC_ASSET_FAILURE'))]):operation,
    dispose:assetMocks.dispose,
  }))
})
afterEach(async()=>{await fs.rm(state.root,{recursive:true,force:true})})

describe('headless packaged asset failure routing',()=>{
  it('keeps the existing ordinary rendering fallback',async()=>{
    const result=await renderMarkdownHeadless({schemaVersion:'1.0',markdown:'# PUBLIC_FALLBACK'})
    expect(result.html).toContain('<h1>PUBLIC_FALLBACK</h1>')
    expect(result.warnings.some(w=>w.code==='FALLBACK_USED')).toBe(true)
    expect(assetMocks.register.mock.invocationCallOrder[0]).toBeLessThan(state.windows[0].loadFile.mock.invocationCallOrder[0])
    expect(assetMocks.dispose).toHaveBeenCalledOnce()
    expect(state.windows[0].destroy).toHaveBeenCalledOnce()
  })

  it('does not convert subresource failure into a successful fallback',async()=>{
    state.mode='asset'
    await expect(renderMarkdownHeadless({schemaVersion:'1.0',markdown:'# PUBLIC_ASSET_FAILURE',timeoutMs:120000})).rejects.toBeInstanceOf(assetMocks.AssetError)
    expect(assetMocks.dispose).toHaveBeenCalledOnce()
    expect(state.windows[0].destroy).toHaveBeenCalledOnce()
  })

  it('cleans up a window when asset-mode initialization fails',async()=>{
    assetMocks.register.mockImplementation(()=>{throw new assetMocks.AssetError('PUBLIC_INIT_FAILURE')})
    await expect(renderMarkdownHeadless({schemaVersion:'1.0',markdown:'# PUBLIC_INIT_FAILURE'})).rejects.toBeInstanceOf(assetMocks.AssetError)
    expect(state.windows[0].loadFile).not.toHaveBeenCalled()
    expect(state.windows[0].destroy).toHaveBeenCalledOnce()
  })

  it('rejects screenshot asset failure before writing a PNG',async()=>{
    state.mode='asset'
    const outputPath=path.join(state.root,'public.png')
    await expect(captureMarkdownScreenshot({renderInput:{schemaVersion:'1.0',markdown:'# PUBLIC_SCREENSHOT'},outputPath})).rejects.toBeInstanceOf(assetMocks.AssetError)
    await expect(fs.access(outputPath)).rejects.toThrow()
    expect(assetMocks.dispose).toHaveBeenCalledOnce()
    expect(state.windows[0].destroy).toHaveBeenCalledOnce()
  })
})
