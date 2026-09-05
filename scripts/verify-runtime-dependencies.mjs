import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { builtinModules, createRequire } from 'node:module'
import ts from 'typescript'

const projectRoot = path.resolve(import.meta.dirname, '..')
const configPath = path.join(projectRoot, 'config', 'runtime-dependencies.json')
const outRoots = [path.join(projectRoot, 'out', 'main'), path.join(projectRoot, 'out', 'preload')]
const require = createRequire(import.meta.url)
const nodeBuiltins = new Set([
  ...builtinModules,
  ...builtinModules.map(name => `node:${name}`),
])

function packageName(specifier) {
  if (specifier.startsWith('@')) return specifier.split('/').slice(0, 2).join('/')
  return specifier.split('/')[0]
}

function isRelativeOrAbsolute(specifier) {
  return specifier.startsWith('.') || specifier.startsWith('/') || /^[A-Za-z]:[\\/]/.test(specifier)
}

async function listJavaScriptFiles(directory) {
  const files = []
  const entries = await fs.readdir(directory, { withFileTypes: true })
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await listJavaScriptFiles(absolute))
    else if (entry.isFile() && /\.(?:c|m)?js$/.test(entry.name)) files.push(absolute)
  }
  return files
}

function literalSpecifier(node) {
  return ts.isStringLiteralLike(node) ? node.text : null
}

function scanSource(filePath, sourceText) {
  const source = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  const specifiers = []
  const computed = []

  const visit = node => {
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      const argument = node.arguments[0]
      const specifier = argument ? literalSpecifier(argument) : null
      if (specifier === null) computed.push({ filePath, position: source.getLineAndCharacterOfPosition(node.getStart()) })
      else specifiers.push(specifier)
    } else if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'require'
    ) {
      const argument = node.arguments[0]
      const specifier = argument ? literalSpecifier(argument) : null
      if (specifier === null) computed.push({ filePath, position: source.getLineAndCharacterOfPosition(node.getStart()) })
      else specifiers.push(specifier)
    } else if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const specifier = node.moduleSpecifier ? literalSpecifier(node.moduleSpecifier) : null
      if (specifier) specifiers.push(specifier)
    }
    ts.forEachChild(node, visit)
  }

  visit(source)
  return { specifiers, computed }
}

async function resolveInstalledPackageManifest(packageNameValue) {
  const entryPath = require.resolve(packageNameValue, { paths: [projectRoot] })
  let current = path.dirname(entryPath)
  while (current !== path.dirname(current)) {
    const manifestPath = path.join(current, 'package.json')
    try {
      const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
      if (manifest.name === packageNameValue) return manifestPath
    } catch (error) {
      if (error?.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error
    }
    current = path.dirname(current)
  }
  throw new Error(`无法定位已安装依赖 ${packageNameValue} 的 package.json`)
}

async function main() {
  const config = JSON.parse(await fs.readFile(configPath, 'utf8'))
  const packageJson = JSON.parse(await fs.readFile(path.join(projectRoot, 'package.json'), 'utf8'))
  const allowed = new Set(config.runtimeDependencies)
  const allowedBuiltins = new Set(config.builtins)
  const declared = new Set(Object.keys(packageJson.dependencies ?? {}))
  const files = []
  for (const root of outRoots) {
    try {
      files.push(...await listJavaScriptFiles(root))
    } catch (error) {
      if (error?.code === 'ENOENT') {
        throw new Error(`缺少构建产物 ${path.relative(projectRoot, root)}，请先运行 npm run build`)
      }
      throw error
    }
  }

  const externalPackages = new Set()
  const computed = []
  for (const file of files) {
    const result = scanSource(file, await fs.readFile(file, 'utf8'))
    computed.push(...result.computed)
    for (const specifier of result.specifiers) {
      if (isRelativeOrAbsolute(specifier) || nodeBuiltins.has(specifier)) continue
      if (allowedBuiltins.has(specifier)) continue
      externalPackages.add(packageName(specifier))
    }
  }

  if (computed.length > 0) {
    const details = computed.map(item => {
      const relative = path.relative(projectRoot, item.filePath)
      return `${relative}:${item.position.line + 1}:${item.position.character + 1}`
    })
    throw new Error(`构建产物包含无法静态解析的 require/import：\n${details.join('\n')}`)
  }

  const missingFromAllowlist = [...externalPackages].filter(name => !allowed.has(name)).sort()
  const unusedAllowlist = [...allowed].filter(name => !externalPackages.has(name)).sort()
  const undeclared = [...allowed].filter(name => !declared.has(name)).sort()
  if (missingFromAllowlist.length || unusedAllowlist.length || undeclared.length) {
    const messages = []
    if (missingFromAllowlist.length) messages.push(`allowlist 缺少：${missingFromAllowlist.join(', ')}`)
    if (unusedAllowlist.length) messages.push(`allowlist 存在未使用项：${unusedAllowlist.join(', ')}`)
    if (undeclared.length) messages.push(`package.json dependencies 未声明：${undeclared.join(', ')}`)
    throw new Error(messages.join('\n'))
  }

  for (const dependency of allowed) {
    await resolveInstalledPackageManifest(dependency)
  }

  console.log(JSON.stringify({
    scannedFiles: files.length,
    runtimeDependencies: [...externalPackages].sort(),
  }, null, 2))
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
