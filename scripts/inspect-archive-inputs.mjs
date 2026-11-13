import fs from 'node:fs/promises'
import path from 'node:path'
import { listPackage, statFile, extractFile } from '@electron/asar'
import { inspectRendererAssets, sha256 } from './prepare-renderer-assets.mjs'

export async function inspectArchiveInputs(projectRoot, stageRoot, archive) {
  await inspectRendererAssets(projectRoot, stageRoot)
  const projection = JSON.parse(await fs.readFile(path.join(stageRoot,'.expected-archive.json'),'utf8'))
  if (projection.formatVersion !== 1 || !Array.isArray(projection.files) || !projection.files.length) throw new Error('Package input projection missing')
  const expected = new Map()
  for (const entry of projection.files) {
    for (const name of [entry.source,entry.path]) {
      if (typeof name !== 'string' || path.posix.isAbsolute(name) || name.includes('\\') || name.split('/').some(part=>!part||part==='.'||part==='..')) throw new Error('Invalid package input path')
    }
    if (expected.has(entry.path)) throw new Error('Duplicate package input')
    const source = await fs.readFile(path.join(stageRoot,entry.source))
    if (sha256(source) !== entry.sourceSha256) throw new Error(`Stage changed after packaging: ${entry.source}`)
    expected.set(entry.path,entry)
  }
  const actual = listPackage(archive).map(name=>name.replace(/^\//,'')).filter(name=>!statFile(archive,name).files)
  if (JSON.stringify([...expected.keys()].sort()) !== JSON.stringify(actual.sort())) throw new Error('ASAR physical file set mismatch')
  for (const name of actual) {
    const info = statFile(archive,name)
    if (info.link) throw new Error(`Unexpected ASAR symlink: ${name}`)
    const bytes = extractFile(archive,name)
    const entry = expected.get(name)
    if (bytes.length !== entry.bytes || sha256(bytes) !== entry.sha256) throw new Error(`ASAR input identity mismatch: ${name}`)
  }
  const audit = JSON.parse(await fs.readFile(path.join(projectRoot,'config/package-pruning-audit.json'),'utf8'))
  for (const entry of audit.removed) {
    if (expected.has(entry.archivePath) || expected.has(entry.path)) throw new Error(`Pruned dependency returned: ${entry.archivePath}`)
  }
  for (const entry of [...audit.retainedMaps,...audit.legalFiles]) {
    const bytes = extractFile(archive,entry.archivePath)
    if (sha256(bytes) !== entry.sha256) throw new Error(`Protected package file changed: ${entry.archivePath}`)
  }
  const closure = JSON.parse(await fs.readFile(path.join(stageRoot,'.runtime-closure.json'),'utf8'))
  for (const entry of closure.packages) {
    const projected = projection.files.filter(file=>file.source === `${entry.path}/package.json`)
    if (projected.length !== 1) throw new Error(`Closure package identity ambiguous: ${entry.path}`)
    const manifest = JSON.parse(extractFile(archive,projected[0].path).toString())
    const original = JSON.parse(await fs.readFile(path.join(stageRoot,entry.path,'package.json'),'utf8'))
    if (manifest.name !== original.name || manifest.version !== entry.version) throw new Error(`Closure package identity changed: ${entry.path}`)
  }
  return { physicalFiles:actual.length, closurePackages:closure.packages.length, protectedLegalFiles:audit.legalFiles.length }
}
