import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { getMainFileMatchers, getNodeModuleFileMatcher } from 'app-builder-lib/out/fileMatcher.js'
import { computeFileSets, computeNodeModuleFileSets } from 'app-builder-lib/out/util/appFileCopier.js'
import { createTransformer } from 'app-builder-lib/out/fileTransformer.js'

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')

// Use this pinned packager's own filters, hoisting and package.json normalization.
export async function capturePackageInputs(context) {
  const packager = context.packager
  const stage = packager.info.appDir
  const destination = path.join(packager.getResourcesDir(context.appOutDir), 'app')
  const expand = pattern => packager.expandMacro(pattern, context.arch)
  const main = getMainFileMatchers(stage, destination, expand, packager.platformSpecificBuildOptions, packager, context.outDir, false)
  const node = getNodeModuleFileMatcher(stage, destination, expand, packager.platformSpecificBuildOptions, packager.info)
  const transform = createTransformer(stage, packager.config, packager.config.extraMetadata)
  const fileSets = [
    ...await computeFileSets(main, transform, packager, false),
    ...await computeNodeModuleFileSets(packager, node),
  ]
  const entries = new Map()
  for (const set of fileSets) {
    for (const file of set.files) {
      const info = await fs.lstat(file)
      if (info.isDirectory()) continue
      if (!info.isFile() || info.isSymbolicLink()) throw new Error('Unexpected package input type')
      const source = path.relative(stage, file).split(path.sep).join('/')
      const archivePath = path.relative(destination, path.join(set.destination, path.relative(set.src, file))).split(path.sep).join('/')
      if (source.startsWith('../') || archivePath.startsWith('../') || path.isAbsolute(source) || path.isAbsolute(archivePath)) throw new Error('Package projection escapes stage')
      const original = await fs.readFile(file)
      const transformed = await transform(file)
      const bytes = transformed == null ? original : Buffer.from(transformed)
      const row = { source, path:archivePath, sourceSha256:sha256(original), sha256:sha256(bytes), bytes:bytes.length }
      const previous = entries.get(archivePath)
      if (previous && previous.sha256 !== row.sha256) throw new Error(`Conflicting package projection: ${archivePath}`)
      entries.set(archivePath,row)
    }
  }
  const manifest = { formatVersion:1, files:[...entries.values()].sort((a,b)=>a.path.localeCompare(b.path)) }
  await fs.writeFile(path.join(stage,'.expected-archive.json'),JSON.stringify(manifest,null,2)+'\n')
}
