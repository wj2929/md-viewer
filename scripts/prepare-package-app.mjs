import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const projectRoot = path.resolve(import.meta.dirname, '..')
const stageRoot = path.join(projectRoot, '.package-app')
const rootManifestPath = path.join(projectRoot, 'package.json')
const rootLockPath = path.join(projectRoot, 'package-lock.json')
const runtimeConfigPath = path.join(projectRoot, 'config', 'runtime-dependencies.json')

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'))
}

function packageNameFromLockPath(lockPath) {
  const marker = 'node_modules/'
  const index = lockPath.lastIndexOf(marker)
  if (index < 0) return null
  return lockPath.slice(index + marker.length)
}

function lockPathForDependency(parentLockPath, dependencyName, packages) {
  let current = parentLockPath
  while (true) {
    const candidate = current
      ? `${current}/node_modules/${dependencyName}`
      : `node_modules/${dependencyName}`
    if (packages[candidate]) return candidate
    const markerIndex = current.lastIndexOf('/node_modules/')
    if (markerIndex < 0) break
    current = current.slice(0, markerIndex)
  }
  const rootCandidate = `node_modules/${dependencyName}`
  return packages[rootCandidate] ? rootCandidate : null
}

function platformAllowed(entry) {
  const check = (values, current) => {
    if (!Array.isArray(values) || values.length === 0) return true
    const positives = values.filter(value => !value.startsWith('!'))
    const negatives = new Set(values.filter(value => value.startsWith('!')).map(value => value.slice(1)))
    if (negatives.has(current)) return false
    return positives.length === 0 || positives.includes(current)
  }
  return check(entry.os, process.platform) && check(entry.cpu, process.arch)
}

function collectClosure(rootDependencies, packages) {
  const selected = new Set()
  const queue = rootDependencies.map(name => ({ name, parent: '' }))

  while (queue.length > 0) {
    const { name, parent } = queue.shift()
    const lockPath = lockPathForDependency(parent, name, packages)
    if (!lockPath) throw new Error(`lockfile 无法解析依赖 ${name}（父路径 ${parent || '<root>'}）`)
    if (selected.has(lockPath)) continue
    const entry = packages[lockPath]
    if (!platformAllowed(entry)) continue
    if (entry.link) throw new Error(`runtime closure 不支持 link/workspace 包：${lockPath}`)
    selected.add(lockPath)

    for (const dependency of Object.keys(entry.dependencies ?? {})) {
      queue.push({ name: dependency, parent: lockPath })
    }
    for (const dependency of Object.keys(entry.optionalDependencies ?? {})) {
      const optionalPath = lockPathForDependency(lockPath, dependency, packages)
      if (optionalPath && platformAllowed(packages[optionalPath])) queue.push({ name: dependency, parent: lockPath })
    }
    for (const dependency of Object.keys(entry.peerDependencies ?? {})) {
      if (entry.peerDependenciesMeta?.[dependency]?.optional === true) continue
      queue.push({ name: dependency, parent: lockPath })
    }
  }

  return [...selected].sort()
}

async function containsNativeModule(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true })
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === '.bin') continue
      if (await containsNativeModule(absolute)) return true
    } else if (entry.isFile() && entry.name.endsWith('.node')) {
      return true
    }
  }
  return false
}

async function copyPackage(lockPath, entry, runtimeConfig) {
  const packageName = packageNameFromLockPath(lockPath)
  if (!packageName) throw new Error(`无效 lock package path：${lockPath}`)
  const sourceDirectory = path.join(projectRoot, lockPath)
  const sourceManifestPath = path.join(sourceDirectory, 'package.json')
  const sourceManifest = await readJson(sourceManifestPath)
  if (sourceManifest.version !== entry.version) {
    throw new Error(`${lockPath} 安装版本 ${sourceManifest.version} 与 lockfile ${entry.version} 不一致`)
  }

  const installKey = `${sourceManifest.name}@${sourceManifest.version}`
  if (entry.hasInstall && !runtimeConfig.installScriptAllowlist.includes(installKey)) {
    throw new Error(`runtime 包含未经允许的 install script：${installKey}`)
  }
  if (await containsNativeModule(sourceDirectory) && !runtimeConfig.nativeModuleAllowlist.includes(installKey)) {
    throw new Error(`runtime 包含未经允许的 native module：${installKey}`)
  }

  const destination = path.join(stageRoot, lockPath)
  await fs.mkdir(path.dirname(destination), { recursive: true })
  await fs.cp(sourceDirectory, destination, {
    recursive: true,
    dereference: false,
    filter: source => {
      const relative = path.relative(sourceDirectory, source)
      if (!relative) return true
      const segments = relative.split(path.sep)
      return !segments.includes('node_modules') && !segments.includes('.bin')
    },
  })
}

async function main() {
  const rootManifest = await readJson(rootManifestPath)
  const lock = await readJson(rootLockPath)
  const runtimeConfig = await readJson(runtimeConfigPath)
  if (lock.lockfileVersion !== 3 || !lock.packages) {
    throw new Error('仅支持 package-lock v3 packages 格式')
  }

  const closure = collectClosure(runtimeConfig.runtimeDependencies, lock.packages)
  await fs.rm(stageRoot, { recursive: true, force: true })
  await fs.mkdir(stageRoot, { recursive: true })
  await fs.cp(path.join(projectRoot, 'out'), path.join(stageRoot, 'out'), { recursive: true })

  const runtimeDependencies = Object.fromEntries(runtimeConfig.runtimeDependencies.map(name => {
    if (!rootManifest.dependencies?.[name]) throw new Error(`根 package.json 未声明 runtime dependency：${name}`)
    const lockEntry = lock.packages[`node_modules/${name}`]
    if (!lockEntry?.version) throw new Error(`lockfile 未锁定 runtime dependency：${name}`)
    return [name, lockEntry.version]
  }))
  const stageManifest = {
    name: rootManifest.name,
    version: rootManifest.version,
    description: rootManifest.description,
    main: rootManifest.main,
    author: rootManifest.author,
    license: rootManifest.license,
    dependencies: runtimeDependencies,
  }
  await fs.writeFile(path.join(stageRoot, 'package.json'), `${JSON.stringify(stageManifest, null, 2)}\n`)

  for (const lockPath of closure) {
    await copyPackage(lockPath, lock.packages[lockPath], runtimeConfig)
  }

  const stageLock = {
    name: stageManifest.name,
    version: stageManifest.version,
    lockfileVersion: 3,
    requires: true,
    packages: Object.fromEntries([
      ['', {
        name: stageManifest.name,
        version: stageManifest.version,
        dependencies: runtimeDependencies,
      }],
      ...closure.map(lockPath => [lockPath, lock.packages[lockPath]]),
    ]),
  }
  await fs.writeFile(path.join(stageRoot, 'package-lock.json'), `${JSON.stringify(stageLock, null, 2)}\n`)
  await fs.writeFile(path.join(stageRoot, '.runtime-closure.json'), `${JSON.stringify({
    schemaVersion: 1,
    packages: closure.map(lockPath => ({ path: lockPath, version: lock.packages[lockPath].version })),
  }, null, 2)}\n`)

  console.log(JSON.stringify({
    stage: path.relative(projectRoot, stageRoot),
    directDependencies: runtimeConfig.runtimeDependencies.length,
    closurePackages: closure.length,
  }, null, 2))
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
