import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { brotliCompress, brotliDecompress, constants } from 'node:zlib'
import { promisify } from 'node:util'

const compress = promisify(brotliCompress)
const decompress = promisify(brotliDecompress)
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')

export async function listRegularFiles(root) {
  const result = []
  async function visit(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (entry.name === '.DS_Store') continue
      const file = path.join(directory, entry.name)
      if (entry.isSymbolicLink()) throw new Error(`Unexpected stage symlink: ${file}`)
      if (entry.isDirectory()) await visit(file)
      else if (entry.isFile()) result.push(path.relative(root, file).split(path.sep).join('/'))
      else throw new Error(`Unexpected stage file type: ${file}`)
    }
  }
  await visit(root)
  return result.sort()
}

export async function verifyFile(root, entry) {
  const file = path.join(root, entry.path)
  const info = await fs.lstat(file)
  if (!info.isFile() || info.isSymbolicLink() || info.size !== entry.bytes) throw new Error(`Asset file identity mismatch: ${entry.path}`)
  const bytes = await fs.readFile(file)
  if (sha256(bytes) !== entry.sha256) throw new Error(`Asset hash mismatch: ${entry.path}`)
  return bytes
}

export async function prepareRendererAssets(projectRoot, stageRoot) {
  const audit = JSON.parse(await fs.readFile(path.join(projectRoot, 'config/package-pruning-audit.json'), 'utf8'))
  const rendererRoot = path.join(stageRoot, 'out/renderer')
  const roles = JSON.parse(await fs.readFile(path.join(rendererRoot, 'renderer-asset-roles.json'), 'utf8'))
  if (roles.formatVersion !== 1 || !Array.isArray(roles.nativeWorkers) || !roles.nativeWorkers.length) throw new Error('Missing native Worker build evidence')
  const files = await listRegularFiles(rendererRoot)
  const nativePaths = new Set()
  for (const worker of roles.nativeWorkers) {
    if (!files.includes(worker.path) || nativePaths.has(worker.path)) throw new Error('Invalid native Worker role')
    nativePaths.add(worker.path)
    await verifyFile(rendererRoot, worker)
  }
  if (!files.includes(roles.fontWorkerModule) || nativePaths.has(roles.fontWorkerModule)) throw new Error('Font Worker URL module missing')
  const notices = await fs.readFile(path.join(projectRoot, 'config/production-distribution-comments.txt'))
  if (notices.length !== audit.notices.bytes || sha256(notices) !== audit.notices.sha256) throw new Error('Distribution notices changed')

  // Qualify the complete pruning set before removing any copied dependency.
  const packageVersions = new Map()
  for (const entry of [...audit.removed, ...audit.retainedMaps, ...audit.legalFiles]) {
    await verifyFile(stageRoot, entry)
    if (!packageVersions.has(entry.packageRoot)) {
      const manifest = JSON.parse(await fs.readFile(path.join(stageRoot, entry.packageRoot, 'package.json'), 'utf8'))
      packageVersions.set(entry.packageRoot, manifest.version)
    }
    if (packageVersions.get(entry.packageRoot) !== entry.packageVersion) throw new Error(`Pruning package changed: ${entry.packageRoot}`)
  }

  const entries = []
  for (const file of files.filter(file => file.endsWith('.js') && !nativePaths.has(file))) {
    const source = await fs.readFile(path.join(rendererRoot, file))
    if (!source.length || source.length > 24 * 1024 * 1024) throw new Error(`Renderer JS exceeds budget: ${file}`)
    const packed = await compress(source, { params: { [constants.BROTLI_PARAM_QUALITY]: 9 } })
    if (!packed.length || packed.length > 16 * 1024 * 1024) throw new Error(`Compressed JS exceeds budget: ${file}`)
    const decoded = await decompress(packed, { maxOutputLength: source.length, chunkSize: Math.max(64, source.length + 1) })
    if (!decoded.equals(source)) throw new Error(`Brotli round trip failed: ${file}`)
    const relative = `out/renderer/${file}`
    await fs.writeFile(path.join(stageRoot, relative + '.br'), packed, { flag: 'wx' })
    entries.push({ path: relative, compressedPath: relative + '.br', bytes: source.length, compressedBytes: packed.length, sha256: sha256(source), compressedSha256: sha256(packed) })
  }
  if (!entries.length || entries.length > 1024) throw new Error('Invalid renderer asset count')
  for (const entry of entries) await fs.unlink(path.join(stageRoot, entry.path))
  for (const entry of audit.removed) await fs.unlink(path.join(stageRoot, entry.path))
  await fs.writeFile(path.join(stageRoot, audit.notices.file), notices, { flag: 'wx' })
  const manifest = { formatVersion: 1, entries }
  await fs.writeFile(path.join(stageRoot, 'renderer-assets.json'), JSON.stringify(manifest) + '\n', { flag: 'wx' })
  const packagePath = path.join(stageRoot, 'package.json')
  const packageJson = JSON.parse(await fs.readFile(packagePath, 'utf8'))
  packageJson.rendererAssetFormat = 1
  await fs.writeFile(packagePath, JSON.stringify(packageJson, null, 2) + '\n')
  return { compressedFiles: entries.length, nativeWorkers: nativePaths.size, removedFiles: audit.removed.length }
}

export async function inspectRendererAssets(projectRoot, stageRoot) {
  const manifest = JSON.parse(await fs.readFile(path.join(stageRoot, 'renderer-assets.json'), 'utf8'))
  const stagePackage = JSON.parse(await fs.readFile(path.join(stageRoot, 'package.json'), 'utf8'))
  if (manifest.formatVersion !== 1 || stagePackage.rendererAssetFormat !== 1 || !Array.isArray(manifest.entries)) throw new Error('Invalid staged asset format')
  const out = path.join(projectRoot, 'out')
  const original = await listRegularFiles(out)
  const actual = await listRegularFiles(path.join(stageRoot, 'out'))
  const roles = JSON.parse(await fs.readFile(path.join(out, 'renderer/renderer-asset-roles.json'), 'utf8'))
  if (roles.formatVersion !== 1 || !Array.isArray(roles.nativeWorkers) || !roles.nativeWorkers.length) throw new Error('Invalid native Worker build evidence')
  const native = new Set(roles.nativeWorkers.map(worker => 'renderer/' + worker.path))
  if (native.size !== roles.nativeWorkers.length || !original.includes('renderer/' + roles.fontWorkerModule)) throw new Error('Invalid native Worker closure')
  for (const worker of roles.nativeWorkers) await verifyFile(path.join(out,'renderer'),worker)
  const mapped = new Map()
  for (const entry of manifest.entries) {
    const name = entry.path.replace(/^out\//, '')
    if (!original.includes(name) || !name.startsWith('renderer/') || !name.endsWith('.js') || native.has(name) || mapped.has(name) || entry.compressedPath !== entry.path + '.br') throw new Error('Invalid asset mapping closure')
    const source = await fs.readFile(path.join(out, name))
    if (source.length !== entry.bytes || sha256(source) !== entry.sha256) throw new Error(`Build identity mismatch: ${name}`)
    const packed = await verifyFile(stageRoot, { path:entry.compressedPath, bytes:entry.compressedBytes, sha256:entry.compressedSha256 })
    const decoded = await decompress(packed, { maxOutputLength: entry.bytes, chunkSize: Math.max(64, entry.bytes + 1) })
    if (!decoded.equals(source)) throw new Error(`Decoded build mismatch: ${name}`)
    mapped.set(name, entry)
  }
  const expected = original.map(name => mapped.has(name) ? name + '.br' : name).sort()
  if (JSON.stringify(expected) !== JSON.stringify(actual)) throw new Error('Stage output file set mismatch')
  for (const name of original) {
    if (name.startsWith('renderer/') && name.endsWith('.js') && !native.has(name) && !mapped.has(name)) throw new Error(`Uncompressed page JS fallback: ${name}`)
    if (!mapped.has(name) && !(await fs.readFile(path.join(out, name))).equals(await fs.readFile(path.join(stageRoot, 'out', name)))) throw new Error(`Unchanged output mismatch: ${name}`)
  }
  const audit = JSON.parse(await fs.readFile(path.join(projectRoot, 'config/package-pruning-audit.json'), 'utf8'))
  for (const entry of audit.removed) {
    try { await fs.lstat(path.join(stageRoot,entry.path)) } catch (error) { if (error.code === 'ENOENT') continue; throw error }
    throw new Error(`Pruned file still present: ${entry.path}`)
  }
  for (const entry of [...audit.retainedMaps,...audit.legalFiles]) await verifyFile(stageRoot,entry)
  await verifyFile(stageRoot,{ path:audit.notices.file, bytes:audit.notices.bytes, sha256:audit.notices.sha256 })
  return { compressedFiles:mapped.size, nativeWorkers:native.size, retainedLegalFiles:audit.legalFiles.length }
}
