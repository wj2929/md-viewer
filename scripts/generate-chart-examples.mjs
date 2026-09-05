import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import AdmZip from 'adm-zip'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE_CONFIG_PATH = path.join(ROOT, 'resources/examples/chart-examples.source.json')
const PACKAGE_PATH = path.join(ROOT, 'resources/examples/md-viewer-chart-examples.zip')
const SIDECAR_PATH = path.join(ROOT, 'resources/examples/md-viewer-chart-examples.manifest.json')
const BENCHMARK_PACKAGE_PATH = path.join(ROOT, '.tmp/chart-examples-single-renderer.zip')
const RENDERER_MANIFEST_PATH = path.join(ROOT, 'src/renderer/public/manifest.json')
const PACKAGE_JSON_PATH = path.join(ROOT, 'package.json')
const ZIP_ROOT = 'md-viewer-chart-examples'
const FIXED_ENTRY_TIME = new Date(2000, 0, 1, 0, 0, 0)

const LANGUAGE_FILES = {
  d2: '02-design-reference/01-d2.md',
  graphviz: '02-design-reference/02-graphviz.md',
  mermaid: '02-design-reference/03-mermaid.md',
  structurizr: '02-design-reference/04-structurizr.md',
  dbml: '02-design-reference/05-dbml.md',
  'antv-g6': '02-design-reference/06-antv-g6.md',
  drawio: '02-design-reference/07-drawio.md',
  svg: '02-design-reference/08-svg.md',
  markmap: '02-design-reference/09-markmap.md',
}

function fail(message) {
  throw new Error(`[chart-examples] ${message}`)
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'))
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function parseTable(lines, heading) {
  const headingIndex = lines.findIndex(line => line.trim() === heading)
  if (headingIndex < 0) fail(`missing heading: ${heading}`)

  const rows = []
  for (let index = headingIndex + 1; index < lines.length; index += 1) {
    const trimmed = lines[index].trim()
    if (!trimmed) {
      if (rows.length) break
      continue
    }
    if (!trimmed.startsWith('|')) {
      if (rows.length) break
      continue
    }
    const cells = trimmed.replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim())
    if (cells.every(cell => /^:?-{3,}:?$/.test(cell))) continue
    rows.push(cells)
  }
  if (rows.length < 2) fail(`table is empty: ${heading}`)
  return rows.slice(1)
}

function normalizeLanguage(value) {
  return value.trim().toLowerCase().replace(/\s+/g, '-').replace('antv-g6', 'antv-g6')
}

function parseDirectory(lines) {
  const rows = parseTable(lines, '### 1.3 完整案例目录')
  const entries = rows.map((cells, index) => {
    if (cells.length !== 4) fail(`invalid directory row ${index + 1}`)
    const idMatch = cells[0].match(/^`([a-z0-9-]+)`$/)
    if (!idMatch) fail(`invalid case id in directory row ${index + 1}`)
    const complexity = cells[3]
    if (!['M', 'H', 'X'].includes(complexity)) fail(`invalid complexity for ${idMatch[1]}`)
    return {
      id: idMatch[1],
      language: normalizeLanguage(cells[1]),
      pattern: cells[2],
      complexity,
    }
  })
  const ids = new Set(entries.map(entry => entry.id))
  if (ids.size !== entries.length) fail('duplicate case id in directory')
  return entries
}

function parseScenarios(lines) {
  const rows = parseTable(lines, '### 1.2 常见任务的组合参考')
  return rows.map((cells, index) => {
    if (cells.length !== 3) fail(`invalid scenario row ${index + 1}`)
    const caseIds = [...cells[1].matchAll(/`([a-z0-9-]+)`/g)].map(match => match[1])
    if (!caseIds.length) fail(`scenario has no cases: ${cells[0]}`)
    return {
      id: `scenario-${String(index + 1).padStart(2, '0')}`,
      name: cells[0],
      caseIds,
      description: cells[2],
    }
  })
}

function parseCases(lines) {
  const cases = []
  const seen = new Set()

  for (let index = 0; index < lines.length; index += 1) {
    const markerMatch = lines[index].trim().match(/^<div id="md-case-([a-z0-9-]+)"><\/div>$/)
    if (!markerMatch) continue

    const id = markerMatch[1]
    if (seen.has(id)) fail(`duplicate marker: ${id}`)
    seen.add(id)

    let fenceStart = index + 1
    while (fenceStart < lines.length && !lines[fenceStart].trim()) fenceStart += 1
    const openMatch = lines[fenceStart]?.match(/^\s*(`{3,}|~{3,})([^`]*)$/)
    if (!openMatch) fail(`marker is not followed by a fence: ${id}`)

    const marker = openMatch[1][0]
    const markerLength = openMatch[1].length
    const language = openMatch[2].trim().split(/\s+/)[0].toLowerCase()
    let fenceEnd = fenceStart + 1
    for (; fenceEnd < lines.length; fenceEnd += 1) {
      const close = lines[fenceEnd].trim()
      if (new RegExp(`^${marker}{${markerLength},}$`).test(close)) break
    }
    if (fenceEnd >= lines.length) fail(`unclosed fence: ${id}`)

    cases.push({
      id,
      language,
      markdown: `${lines.slice(fenceStart, fenceEnd + 1).join('\n')}\n`,
    })
    index = fenceEnd
  }

  return cases
}

function extractLanguageGuide(lines) {
  const start = lines.findIndex(line => line.trim() === '## 2. 图形语言选择指南')
  if (start < 0) fail('missing language guide')
  let end = start + 1
  while (end < lines.length && !/^##\s+/.test(lines[end])) end += 1
  return lines.slice(start + 1, end).join('\n').trim()
}

function validateSources(config, directory, scenarios, cases, rendererManifest, templates) {
  if (directory.length !== config.expectedCaseCount) {
    fail(`expected ${config.expectedCaseCount} directory entries, got ${directory.length}`)
  }
  if (cases.length !== config.expectedCaseCount) {
    fail(`expected ${config.expectedCaseCount} markers, got ${cases.length}`)
  }

  const directoryById = new Map(directory.map(entry => [entry.id, entry]))
  const caseById = new Map(cases.map(entry => [entry.id, entry]))
  for (const id of directoryById.keys()) {
    if (!caseById.has(id)) fail(`directory case has no marker: ${id}`)
  }
  for (const id of caseById.keys()) {
    if (!directoryById.has(id)) fail(`marker has no directory row: ${id}`)
  }

  const rendererByLanguage = new Map()
  for (const renderer of rendererManifest.renderers) {
    for (const language of [...renderer.languages, ...renderer.aliases]) {
      rendererByLanguage.set(language.toLowerCase(), renderer)
    }
  }

  const counts = {}
  for (const item of cases) {
    const directoryEntry = directoryById.get(item.id)
    if (item.language !== directoryEntry.language) {
      fail(`language mismatch for ${item.id}: ${item.language} != ${directoryEntry.language}`)
    }
    const renderer = rendererByLanguage.get(item.language)
    if (!renderer || !renderer.sourceKinds.includes('fence')) {
      fail(`unsupported case language: ${item.language}`)
    }
    if (!(item.language in LANGUAGE_FILES)) fail(`no output file for language: ${item.language}`)
    counts[item.language] = (counts[item.language] || 0) + 1
  }

  for (const [language, expected] of Object.entries(config.expectedLanguages)) {
    if (counts[language] !== expected) {
      fail(`expected ${expected} ${language} cases, got ${counts[language] || 0}`)
    }
  }
  if (Object.keys(counts).length !== Object.keys(config.expectedLanguages).length) {
    fail('case languages differ from expected language set')
  }

  for (const scenario of scenarios) {
    for (const caseId of scenario.caseIds) {
      if (!directoryById.has(caseId)) fail(`unknown scenario case: ${caseId}`)
    }
  }

  const templateIds = new Set()
  for (const template of templates) {
    if (!template.id || templateIds.has(template.id)) fail(`invalid or duplicate template id: ${template.id}`)
    templateIds.add(template.id)
    if (!rendererManifest.renderers.some(renderer => renderer.type === template.rendererType)) {
      fail(`unknown template renderer: ${template.rendererType}`)
    }
    for (const field of ['title', 'description', 'prefix', 'body', 'suffix']) {
      if (typeof template[field] !== 'string' || !template[field]) fail(`template ${template.id} has invalid ${field}`)
    }
  }

  const rendererTypes = new Set(rendererManifest.renderers.map(renderer => renderer.type))
  const templatedTypes = new Set(templates.map(template => template.rendererType))
  for (const type of rendererTypes) {
    if (!templatedTypes.has(type)) fail(`renderer has no starter template: ${type}`)
  }
}

function renderQuickStart(templates, rendererManifest) {
  const rendererByType = new Map(rendererManifest.renderers.map(renderer => [renderer.type, renderer]))
  const sections = templates.map(template => {
    const renderer = rendererByType.get(template.rendererType)
    const fullSource = `${template.prefix}${template.body}${template.suffix}`
    const lines = [
      `## ${template.title}`,
      '',
      template.description,
      '',
    ]
    if (renderer.networkPolicy !== 'offlineOnly') {
      lines.push(
        '> 此 renderer 标记为“需服务”。默认会连接对应服务并自动渲染；可在“设置 → 图表 → 渲染服务”关闭，关闭后每篇文档只需确认一次。只会发送对应图表块的源码。',
        '',
      )
    }
    lines.push(fullSource, '')
    return lines.join('\n')
  })

  return `# 图表与公式快速入门\n\n` +
    `[示例包首页](./README.md) · [设计参考](./02-design-reference/README.md) · [专项案例库](./03-renderer-gallery/README.md)\n\n` +
    `本页覆盖 MD Viewer 当前注册的 ${rendererManifest.renderers.length} 类图表与公式能力。这里提供最小、可复制的起步源码；需要比较更多语法变体时再进入专项案例库。\n\n` +
    `**使用方式**：先确认示例在应用中正常渲染，再复制对应源码块，替换业务名称、数据和约束；需要交付时继续验证 HTML、PDF 或 DOCX 导出。\n\n` +
    `离线 renderer 会直接渲染；标记“需服务”的示例默认自动渲染，也可关闭后按文档确认。\n\n` +
    `${sections.join('\n')}\n`
}

function renderDesignIndex(directory, scenarios, languageGuide) {
  const lines = [
    '# 架构图与流程图设计参考',
    '',
    '[示例包首页](../README.md) · [快速入门](../01-quick-start.md) · [专项案例库](../03-renderer-gallery/README.md)',
    '',
    `本目录包含 ${directory.length} 个已评审正例，适合先确定信息结构、关系语义和版式，再选择 renderer。若已经确定 renderer、只想查找 DSL 语法变体，请转到专项案例库。`,
    '',
    '请迁移案例的表达模型、布局策略和连线语义，不要照抄示例业务名称、数值或系统边界。案例键可用于文档内搜索和来源追溯。',
    '',
    '## 按语言浏览',
    '',
  ]
  for (const [language, file] of Object.entries(LANGUAGE_FILES)) {
    const count = directory.filter(entry => entry.language === language).length
    lines.push(`- [${language}（${count} 例）](./${file.replace('02-design-reference/', '')})`)
  }
  lines.push('', '## 按任务选择', '', '| 任务 | 推荐案例 | 分工 |', '|---|---|---|')
  for (const scenario of scenarios) {
    lines.push(`| ${scenario.name} | ${scenario.caseIds.map(id => `\`${id}\``).join(' + ')} | ${scenario.description} |`)
  }
  lines.push(
    '',
    '## 图形语言选择指南',
    '',
    languageGuide,
    '',
    '## 阅读提示',
    '',
    '- 先理解案例表达的问题，再复制源码；不要仅按画面相似度选图。',
    '- 设计参考强调结构与语义，不是可直接采用的业务事实或生产配置。',
    '- 需要同一 renderer 的更多合法语法时，前往 [专项案例库](../03-renderer-gallery/README.md)。',
    '',
  )
  return `${lines.join('\n')}\n`
}

function renderLanguageDocument(language, entries, caseById) {
  const tableOfContents = entries.map(entry => `- [\`${entry.id}\` · ${entry.pattern}](#heading-${entry.id})`)
  const sections = entries.map(entry => {
    const source = caseById.get(entry.id).markdown
    return `<a id="heading-${entry.id}"></a>\n\n` +
      `## ${entry.pattern}\n\n` +
      `- 案例键：\`${entry.id}\`\n` +
      `- 复杂度：${entry.complexity}\n\n` +
      source
  })
  return `# ${language} 设计案例\n\n` +
    `[设计参考目录](./README.md) · [示例包首页](../README.md) · [专项案例库](../03-renderer-gallery/README.md)\n\n` +
    `本页包含 ${entries.length} 个 ${language} 正例。示例只用于迁移表达模型与版式，实际内容应以目标系统事实为准。\n\n` +
    `**本页目录**\n\n${tableOfContents.join('\n')}\n\n` +
    `${sections.join('\n')}\n`
}

function parseMarkdownSections(markdown, headingLevel) {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const sections = []
  let fence = null
  let current = null

  const finishCurrent = (end) => {
    if (!current) return
    current.markdown = lines.slice(current.start + 1, end).join('\n').trim()
    sections.push(current)
  }

  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim()
    const fenceMatch = trimmed.match(/^(`{3,}|~{3,})/)
    if (fenceMatch) {
      const marker = fenceMatch[1]
      if (!fence) fence = { character: marker[0], length: marker.length }
      else if (marker[0] === fence.character && marker.length >= fence.length && new RegExp(`^${fence.character}{${fence.length},}\\s*$`).test(trimmed)) fence = null
      continue
    }
    if (fence) continue

    const headingMatch = lines[index].match(new RegExp(`^#{${headingLevel}}\\s+(.+?)\\s*#*\\s*$`))
    if (!headingMatch) continue
    finishCurrent(index)
    current = { title: headingMatch[1].trim(), start: index, markdown: '' }
  }
  finishCurrent(lines.length)
  return sections
}

function stripFixtureOnlyMarkup(markdown) {
  return markdown
    .split('\n')
    .filter(line => !/^\s*(?:<!--.*(?:test[_ -]?case|e2e|fixture|md[_ -]?test).*-->|<div\s+id=["']md-case-[^"']+["']><\/div>)\s*$/i.test(line))
    .join('\n')
    .trim()
}

function findReferencedAssets(markdown) {
  return [...markdown.matchAll(/!\[[^\]]*\]\(([^)]+\.(?:bpmn|excalidraw))(?:[?#][^)]*)?\)/gi)]
    .map(match => match[1].trim().replaceAll('\\\\', '/').replace(/^\.\//, ''))
    .sort()
}

function findFenceLanguages(markdown) {
  const languages = []
  let fence = null
  for (const line of markdown.split('\n')) {
    const match = line.trim().match(/^(`{3,}|~{3,})([^`~]*)$/)
    if (!match) continue
    const marker = match[1]
    if (!fence) {
      fence = { character: marker[0], length: marker.length }
      const language = match[2].trim().split(/\s+/)[0].toLowerCase()
      if (language) languages.push(language)
    } else if (marker[0] === fence.character && marker.length >= fence.length && !match[2].trim()) {
      fence = null
    }
  }
  return languages
}

function validateItemSource(item, markdown, renderer) {
  const actualKinds = []
  const fenceLanguages = findFenceLanguages(markdown)
  if (fenceLanguages.length) actualKinds.push('fence')
  if (item.rendererType === 'katex') {
    if (markdown.includes('$$') || markdown.includes('\\[')) actualKinds.push('blockMath')
    if (/(?<!\$)\$(?!\$).+?(?<!\$)\$(?!\$)/s.test(markdown)) actualKinds.push('inlineMath')
  }
  if (['bpmn', 'excalidraw'].includes(item.rendererType) && findReferencedAssets(markdown).length) actualKinds.push('fileReference')
  if (JSON.stringify(actualKinds.sort()) !== JSON.stringify([...item.sourceKinds].sort())) fail(`source kind drift for ${item.id}`)

  if (actualKinds.includes('fence')) {
    const acceptedLanguages = new Set([...renderer.languages, ...renderer.aliases].map(language => language.toLowerCase()))
    if (item.rendererType === 'echarts') ['js', 'javascript', 'json'].forEach(language => acceptedLanguages.add(language))
    if (!fenceLanguages.some(language => acceptedLanguages.has(language))) {
      fail(`renderer fence mismatch for ${item.id}: ${fenceLanguages.join(',')}`)
    }
  }
}

function validateRelativeFixturePath(relativePath, label) {
  if (typeof relativePath !== 'string' || !relativePath || path.isAbsolute(relativePath)) fail(`invalid ${label}: ${relativePath}`)
  const normalized = path.posix.normalize(relativePath.replaceAll('\\\\', '/'))
  if (normalized === '..' || normalized.startsWith('../') || !normalized.startsWith('e2e/fixtures/')) {
    fail(`${label} escapes e2e/fixtures: ${relativePath}`)
  }
  return normalized
}

function buildGallery(config, catalog, rendererManifest, templates, root, options = {}) {
  if (catalog.schemaVersion !== '1.2' || !Array.isArray(catalog.collections) || !Array.isArray(catalog.items)) {
    fail('invalid gallery catalog schema')
  }

  const collectionById = new Map()
  const collectionMetadataFields = ['description', 'whenToUse', 'nonGoals', 'readerHint']
  for (const collection of catalog.collections) {
    if (!collection.id || collectionById.has(collection.id)) fail(`invalid or duplicate collection: ${collection.id}`)
    for (const field of collectionMetadataFields) {
      if (typeof collection[field] !== 'string' || !collection[field].trim()) {
        fail(`missing collection ${field}: ${collection.id}`)
      }
    }
    collectionById.set(collection.id, collection)
  }

  const rendererPageSizes = catalog.rendererPageSizes || {}
  if (!rendererPageSizes || typeof rendererPageSizes !== 'object' || Array.isArray(rendererPageSizes)) {
    fail('invalid renderer page sizes')
  }
  for (const [rendererType, pageSize] of Object.entries(rendererPageSizes)) {
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 250) {
      fail(`invalid page size for renderer: ${rendererType}`)
    }
  }

  const rendererByType = new Map(rendererManifest.renderers.map(renderer => [renderer.type, renderer]))
  const descriptionsByRenderer = new Map()
  for (const template of templates) {
    const descriptions = descriptionsByRenderer.get(template.rendererType) || []
    if (!descriptions.includes(template.description)) descriptions.push(template.description)
    descriptionsByRenderer.set(template.rendererType, descriptions)
  }
  for (const rendererType of Object.keys(rendererPageSizes)) {
    if (!rendererByType.has(rendererType)) fail(`unknown paginated renderer: ${rendererType}`)
  }
  const itemIds = new Set()
  const sectionCache = new Map()
  const positiveItems = []
  const classificationCounts = {}

  for (const item of catalog.items) {
    if (!item.id || itemIds.has(item.id)) fail(`invalid or duplicate gallery item: ${item.id}`)
    itemIds.add(item.id)
    if (!['positive', 'negative', 'stress', 'infra'].includes(item.classification)) fail(`unknown classification: ${item.id}`)
    classificationCounts[item.classification] = (classificationCounts[item.classification] || 0) + 1
    if (!collectionById.has(item.collectionId)) fail(`unknown collection for ${item.id}`)
    const renderer = rendererByType.get(item.rendererType)
    if (!renderer) fail(`unknown renderer for ${item.id}: ${item.rendererType}`)
    if (item.networkPolicy !== renderer.networkPolicy) fail(`network policy mismatch for ${item.id}`)

    const fixturePath = validateRelativeFixturePath(item.fixturePath, `fixture path for ${item.id}`)
    const cacheKey = `${fixturePath}:${item.headingLevel}`
    if (!sectionCache.has(cacheKey)) {
      const source = readFileSync(path.join(root, fixturePath), 'utf8')
      sectionCache.set(cacheKey, parseMarkdownSections(source, item.headingLevel))
    }
    const matches = sectionCache.get(cacheKey).filter(section => section.title === item.sectionTitle)
    if (matches.length !== 1) fail(`expected one section for ${item.id}, got ${matches.length}`)

    if (item.classification !== 'positive') continue
    const section = matches[0]
    const actualAssets = findReferencedAssets(section.markdown)
    const declaredAssets = [...item.assets].sort()
    if (JSON.stringify(actualAssets) !== JSON.stringify(declaredAssets)) fail(`asset list drift for ${item.id}`)
    if (!Array.isArray(item.sourceKinds) || item.sourceKinds.length === 0) fail(`positive item has no source kind: ${item.id}`)
    validateItemSource(item, section.markdown, renderer)
    positiveItems.push({ ...item, fixturePath, sectionMarkdown: stripFixtureOnlyMarkup(section.markdown) })
  }

  if (positiveItems.length !== catalog.expectedPositiveCount) fail(`expected ${catalog.expectedPositiveCount} gallery cases, got ${positiveItems.length}`)
  for (const classification of ['positive', 'negative', 'stress', 'infra']) {
    if ((classificationCounts[classification] || 0) !== catalog.expectedClassificationCounts[classification]) {
      fail(`gallery ${classification} count drifted`)
    }
  }

  const countsByRenderer = Object.fromEntries(rendererManifest.renderers.map(renderer => [renderer.type, 0]))
  const countsByCollection = Object.fromEntries(catalog.collections.map(collection => [collection.id, 0]))
  for (const item of positiveItems) {
    countsByRenderer[item.rendererType] += 1
    countsByCollection[item.collectionId] += 1
  }
  for (const [rendererType, count] of Object.entries(countsByRenderer)) {
    if (count !== (catalog.expectedCountsByRenderer[rendererType] || 0)) fail(`gallery renderer count drifted: ${rendererType}`)
  }

  const files = new Map()
  const assetOutputs = new Set()
  for (const collection of catalog.collections) {
    const collectionItems = positiveItems.filter(item => item.collectionId === collection.id)
    const rendererRows = []
    const rendererTypes = [...new Set(collectionItems.map(item => item.rendererType))]
    for (const rendererType of rendererTypes) {
      const renderer = rendererByType.get(rendererType)
      const rendererItems = collectionItems.filter(item => item.rendererType === rendererType)
      const pageSize = options.singleRendererPages
        ? rendererItems.length
        : rendererPageSizes[rendererType] || rendererItems.length
      const pageCount = Math.ceil(rendererItems.length / pageSize)
      const pageNames = Array.from({ length: pageCount }, (_, pageIndex) => pageCount === 1
        ? `${rendererType}.md`
        : `${rendererType}-${String(pageIndex + 1).padStart(2, '0')}.md`)
      const rendererPageLinks = []

      for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
        const pageItems = rendererItems.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize)
        const pageName = pageNames[pageIndex]
        const pagePath = `${collection.outputDirectory}/${pageName}`
        const titleSuffix = pageCount > 1 ? `（${pageIndex + 1}/${pageCount}）` : ''
        const remoteNote = renderer.networkPolicy === 'offlineOnly'
          ? '本页图表可在应用中离线渲染。'
          : '本页文件可离线浏览源码；图形默认连接所配置的服务自动渲染。可在“设置 → 图表 → 渲染服务”关闭，关闭后每篇文档只需确认一次；发送范围仅限对应图表块源码。'
        const navigation = [
          pageIndex > 0 ? `[← 上一页](./${pageNames[pageIndex - 1]})` : null,
          '[分类目录](./README.md)',
          '[专项案例库](../README.md)',
          '[示例包首页](../../README.md)',
          pageIndex + 1 < pageCount ? `[下一页 →](./${pageNames[pageIndex + 1]})` : null,
        ].filter(Boolean).join(' · ')
        const tableOfContents = pageItems.map(item => `- [\`${item.id}\` · ${item.title}](#heading-${item.id})`)
        const sections = pageItems.map(item =>
          `<a id="heading-${item.id}"></a>\n\n` +
          `## ${item.title}\n\n` +
          `- 案例 ID：\`${item.id}\`\n\n` +
          `${item.sectionMarkdown}\n`
        )
        const pageMarkdown = `# ${renderer.displayName || rendererType} 专项案例${titleSuffix}\n\n` +
          `${navigation}\n\n` +
          `本页包含 ${pageItems.length} 个经 catalog 标记为 positive 的正例。${remoteNote}\n\n` +
          `这些内容用于查找 ${rendererType} 的合法语法和渲染变体，不代表可直接采用的业务事实或最佳实践。复制后请替换名称、数据、边界和约束，并先确认预览成功。\n\n` +
          `**本页目录**\n\n${tableOfContents.join('\n')}\n\n` +
          `${sections.join('\n')}\n---\n\n${navigation}\n`
        if (Buffer.byteLength(pageMarkdown) > 750_000) fail(`gallery page exceeds render limit: ${pagePath}`)
        files.set(pagePath, pageMarkdown)
        rendererPageLinks.push(pageCount === 1
          ? `[打开](./${pageName})`
          : `[第 ${pageIndex + 1} 页](./${pageName})`)

        for (const item of pageItems) {
          for (const asset of item.assets) {
            const fixtureDirectory = path.posix.dirname(item.fixturePath)
            const sourceRelative = validateRelativeFixturePath(path.posix.join(fixtureDirectory, asset), `asset for ${item.id}`)
            const sourcePath = path.join(root, sourceRelative)
            if (!existsSync(sourcePath)) fail(`missing asset for ${item.id}: ${asset}`)
            const outputPath = `${collection.outputDirectory}/${asset}`
            const bytes = readFileSync(sourcePath)
            if (files.has(outputPath) && !Buffer.from(files.get(outputPath)).equals(bytes)) fail(`conflicting asset output: ${outputPath}`)
            files.set(outputPath, bytes)
            assetOutputs.add(outputPath)
          }
        }
      }

      const description = (descriptionsByRenderer.get(rendererType) || [renderer.userHelp.settingsDescription]).join(' ')
      const runtime = renderer.networkPolicy === 'offlineOnly' ? '本地' : '需服务'
      rendererRows.push(`| ${renderer.displayName || rendererType}（\`${rendererType}\`） | ${description} | ${rendererItems.length} | ${runtime} | ${rendererPageLinks.join('<br>')} |`)
    }

    const serviceNote = collectionItems.some(item => item.networkPolicy !== 'offlineOnly')
      ? '> 本分类包含服务型 renderer。打开文件可以离线阅读源码；实际生成图形时可能把对应图表块源码发送给所配置的 PlantUML 或 Kroki 服务。'
      : '> 本分类中的 renderer 均可在应用内离线渲染。'
    const collectionReadme = `# ${collection.title}\n\n` +
      `[示例包首页](../../README.md) · [专项案例库](../README.md) · [设计参考](../../02-design-reference/README.md)\n\n` +
      `${collection.description}\n\n` +
      `**适合**：${collection.whenToUse}\n\n` +
      `**不适合**：${collection.nonGoals}\n\n` +
      `${serviceNote}\n\n` +
      `## 选择 renderer\n\n` +
      `| Renderer | 适用方向 | 正例 | 运行方式 | 页面 |\n|---|---|---:|---|---|\n` +
      `${rendererRows.join('\n')}\n\n` +
      `## 阅读方式\n\n` +
      `- ${collection.readerHint}\n` +
      `- 每个案例都带稳定案例 ID；可使用文档内搜索定位标题或 ID。\n` +
      `- 默认每个 renderer 使用一个 Markdown；仅对连续性能实测超限且分页有效的 renderer 固定分页。分页页面提供上一页和下一页。\n` +
      `- 想先确定“该画什么图”时，返回 [设计参考](../../02-design-reference/README.md)；已经确定 renderer、想查语法变体时留在本分类。\n`
    files.set(`${collection.outputDirectory}/README.md`, collectionReadme)
  }

  const collectionRows = catalog.collections.map(collection => {
    const collectionItems = positiveItems.filter(item => item.collectionId === collection.id)
    const remoteCount = collectionItems.filter(item => item.networkPolicy !== 'offlineOnly').length
    const runtime = remoteCount === 0 ? '本地' : remoteCount === collectionItems.length ? '需服务' : `混合（${remoteCount} 个需服务）`
    const relativeDirectory = collection.outputDirectory.replace('03-renderer-gallery/', '')
    return `| [${collection.title}](./${relativeDirectory}/README.md) | ${collection.description} | ${countsByCollection[collection.id]} | ${runtime} |`
  })
  files.set('03-renderer-gallery/README.md', `# Renderer 专项案例库\n\n` +
    `[示例包首页](../README.md) · [快速入门](../01-quick-start.md) · [设计参考](../02-design-reference/README.md)\n\n` +
    `本目录适合在已经确定 renderer 后查找合法语法和渲染变体；如果还不知道该用哪种图表达问题，请先查看设计参考。\n\n` +
    `这里包含 ${positiveItems.length} 个从项目 fixture 通过 catalog 明确筛选的 positive 条目。它们是可运行正例，不等于通用业务模板或最佳实践。negative、stress 和 infra 共 ${catalog.items.length - positiveItems.length} 个条目，不进入用户示例页。\n\n` +
    `## 按主题选择\n\n` +
    `| 分类 | 适用方向 | 正例 | 运行方式 |\n|---|---|---:|---|\n${collectionRows.join('\n')}\n\n` +
    `## 如何阅读\n\n` +
    `1. 先在分类页根据表达目标选择 renderer。\n` +
    `2. 用案例 ID 或标题定位变体，查看渲染结果和对应源码。\n` +
    `3. 复制最小源码块，替换业务名称、数据、访问边界和约束。\n` +
    `4. 先确认应用预览成功，再验证 HTML、PDF 或 DOCX 导出。\n`
  )

  return {
    files,
    galleryCaseCount: positiveItems.length,
    assetCount: assetOutputs.size,
    countsByCollection,
    countsByRenderer,
    remoteCaseCount: positiveItems.filter(item => item.networkPolicy === 'explicitRemoteAllowed').length,
  }
}

function renderRootReadme(version, packageVersion, designCaseCount, galleryStats, rendererManifest) {
  const rendererCount = rendererManifest.renderers.length
  const totalCaseCount = designCaseCount + galleryStats.galleryCaseCount
  const allExportFormatsSupported = rendererManifest.renderers.every(renderer =>
    ['html', 'pdf', 'docxClient'].every(format => renderer.capabilities[format]?.state === 'supported')
  )
  const exportSummary = allExportFormatsSupported
    ? `当前 ${rendererCount} 类 renderer 均声明支持应用预览以及 HTML、PDF、DOCX 导出。`
    : '各 renderer 的导出能力可能不同，请以应用“设置 → 图表”显示的格式支持为准。'

  return `# MD Viewer 图表示例\n\n` +
    `> 内容版本：${packageVersion}  \n> 适用 MD Viewer：${version}  \n> 共 ${totalCaseCount} 个案例：${designCaseCount} 个设计核心案例 + ${galleryStats.galleryCaseCount} 个专项正例。  \n> 文件清单、字节数和 SHA-256 见同目录 \`manifest.json\`。\n\n` +
    `本包可以离线保存和浏览，帮助你从最小语法、设计问题或指定 renderer 三条路线找到可复制源码。\n\n` +
    `## 先选一条路线\n\n` +
    `1. **第一次写图表**：打开 [图表与公式快速入门](./01-quick-start.md)，从 ${rendererCount} 类 renderer 的最小示例开始。\n` +
    `2. **还不知道该画什么图**：打开 [架构图与流程图设计参考](./02-design-reference/README.md)，按场景和表达目标浏览 ${designCaseCount} 个设计核心正例。\n` +
    `3. **已经确定 renderer**：打开 [Renderer 专项案例库](./03-renderer-gallery/README.md)，按主题、案例 ID 或标题查找 ${galleryStats.galleryCaseCount} 个语法变体。\n\n` +
    `## 第一次成功\n\n` +
    `1. 在快速入门中选择 Mermaid、KaTeX 等未标记“需服务”的 renderer。\n` +
    `2. 确认示例已经显示为图形或公式，而不是代码块。\n` +
    `3. 复制对应 Markdown 源码到自己的文档。\n` +
    `4. 替换业务名称、数据、边界和约束，保存后再次确认预览。\n` +
    `5. 需要交付时，再验证 HTML、PDF 或 DOCX 导出。\n\n` +
    `## 如何使用案例\n\n` +
    `- **快速入门**来自内置 starter，适合从零复制最小源码。\n` +
    `- **设计参考**强调信息结构、布局和关系语义，适合借鉴表达模型。\n` +
    `- **专项案例**从 E2E fixture 中按 catalog 筛选 positive 条目，适合核对 renderer 的语法和渲染边界，不等于通用业务模板或最佳实践。\n` +
    `- 以自己的真实源码、需求和系统事实为准，不要照抄案例中的业务名称、数值、依赖或安全边界。\n\n` +
    `## 离线、服务与隐私\n\n` +
    `| 类型 | 打开文件 | 生成图形 | 发送范围 |\n|---|---|---|---|\n` +
    `| 本地 renderer | 离线 | 在应用内完成 | 不发送图表源码 |\n` +
    `| PlantUML / C4-PlantUML | 可离线浏览源码 | 连接所配置的 PlantUML 服务 | 对应图表块源码 |\n` +
    `| Kroki | 可离线浏览源码 | 连接所配置的 Kroki 服务 | 对应图表块源码 |\n\n` +
    `服务型图表默认自动渲染。可在“设置 → 图表 → 渲染服务”关闭；关闭后普通 Markdown 每篇只需确认一次。设置尚未加载或读取失败时不会发送源码。\n\n` +
    `## 导出\n\n` +
    `${exportSummary} 导出成功以图表完成渲染为前提；服务型图表还需要对应服务可用并满足当次导出的网络确认。失败时应用会报告错误或使用中性占位，不会把源码冒充成已生成的图形。\n\n` +
    `## 渲染失败时\n\n` +
    `1. 在快速入门中打开同 renderer 的最小示例，判断是语法问题还是运行环境问题。\n` +
    `2. 核对代码围栏语言以及 JSON、XML 或 DSL 语法。\n` +
    `3. 对 BPMN、Excalidraw 等文件引用，检查相对路径和配套资源是否仍在。\n` +
    `4. 对 PlantUML、C4-PlantUML、Kroki，检查渲染服务地址、网络状态和自动渲染/文档确认状态。\n` +
    `5. 先确认应用预览成功，再检查 HTML、PDF 或 DOCX 导出；保留源码和错误提示以便排查。\n\n` +
    `## 统计与来源\n\n` +
    `- ${totalCaseCount} = ${designCaseCount} 个设计核心案例 + ${galleryStats.galleryCaseCount} 个 catalog positive 专项条目，两类统计互不重复。\n` +
    `- negative、stress、infra 和未声明资源不会进入用户案例页。\n` +
    `- manifest 校验说明包内容与生成时清单一致，不代表服务型案例在当前设备和网络上一定实时成功。\n` +
    `- 本包由项目生成器构建；请修改源配置并重新生成，不要直接编辑应用数据目录中的安装副本。\n`
}

export function buildChartExamples(root = ROOT, options = {}) {
  const config = readJson(path.join(root, path.relative(ROOT, SOURCE_CONFIG_PATH)))
  const packageJson = readJson(path.join(root, 'package.json'))
  const rendererManifest = readJson(path.join(root, path.relative(ROOT, RENDERER_MANIFEST_PATH)))
  const templates = readJson(path.join(root, config.starterTemplates))
  const catalog = readJson(path.join(root, config.galleryCatalog))
  const fixtureText = readFileSync(path.join(root, config.designReference), 'utf8').replace(/\r\n/g, '\n')
  const lines = fixtureText.split('\n')
  const directory = parseDirectory(lines)
  const scenarios = parseScenarios(lines)
  const cases = parseCases(lines)
  validateSources(config, directory, scenarios, cases, rendererManifest, templates)

  const caseById = new Map(cases.map(item => [item.id, item]))
  const gallery = buildGallery(config, catalog, rendererManifest, templates, root, options)
  const files = new Map()
  files.set('01-quick-start.md', renderQuickStart(templates, rendererManifest))
  files.set('02-design-reference/README.md', renderDesignIndex(directory, scenarios, extractLanguageGuide(lines)))

  for (const [language, file] of Object.entries(LANGUAGE_FILES)) {
    files.set(file, renderLanguageDocument(language, directory.filter(entry => entry.language === language), caseById))
  }
  for (const [name, content] of gallery.files) files.set(name, content)
  files.set('README.md', renderRootReadme(
    packageJson.version,
    config.packageVersion,
    directory.length,
    gallery,
    rendererManifest,
  ))

  const totalCaseCount = directory.length + gallery.galleryCaseCount
  const countsByCollection = {
    'design-reference': directory.length,
    ...gallery.countsByCollection,
  }
  const countsByRenderer = { ...gallery.countsByRenderer }
  for (const [rendererType, count] of Object.entries(config.expectedLanguages)) {
    countsByRenderer[rendererType] = (countsByRenderer[rendererType] || 0) + count
  }
  const contentEntries = [...files.entries()].map(([name, content]) => ({
    name,
    bytes: Buffer.byteLength(content),
    sha256: sha256(content),
  }))
  const internalManifest = {
    schemaVersion: '1.1',
    packageId: config.packageId,
    packageVersion: config.packageVersion,
    minAppVersion: packageJson.version,
    maxAppVersion: packageJson.version,
    rendererCount: rendererManifest.renderers.length,
    starterCount: templates.length,
    designCaseCount: directory.length,
    galleryCaseCount: gallery.galleryCaseCount,
    totalCaseCount,
    caseCount: totalCaseCount,
    assetCount: gallery.assetCount,
    remoteCaseCount: gallery.remoteCaseCount,
    countsByCollection,
    countsByRenderer,
    languages: config.expectedLanguages,
    files: contentEntries,
  }
  files.set('manifest.json', `${JSON.stringify(internalManifest, null, 2)}\n`)

  for (const [name, content] of files) {
    if (typeof content === 'string' && content.includes('md-case-')) fail(`fixture marker leaked into ${name}`)
  }

  const zip = new AdmZip()
  for (const [name, content] of [...files.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const entryName = `${ZIP_ROOT}/${name}`
    zip.addFile(entryName, Buffer.from(content, 'utf8'))
    const entry = zip.getEntry(entryName)
    if (entry) entry.header.time = FIXED_ENTRY_TIME
  }
  const zipBuffer = zip.toBuffer()
  const sidecar = {
    schemaVersion: '1.1',
    packageId: config.packageId,
    packageVersion: config.packageVersion,
    minAppVersion: packageJson.version,
    maxAppVersion: packageJson.version,
    filename: path.basename(PACKAGE_PATH),
    bytes: zipBuffer.length,
    sha256: sha256(zipBuffer),
    rendererCount: rendererManifest.renderers.length,
    starterCount: templates.length,
    designCaseCount: directory.length,
    galleryCaseCount: gallery.galleryCaseCount,
    totalCaseCount,
    caseCount: totalCaseCount,
    assetCount: gallery.assetCount,
    remoteCaseCount: gallery.remoteCaseCount,
    countsByCollection,
    countsByRenderer,
    languages: config.expectedLanguages,
  }

  return {
    zipBuffer,
    sidecarText: `${JSON.stringify(sidecar, null, 2)}\n`,
    files,
  }
}

function replaceFileAtomically(targetPath, content) {
  const temporaryPath = `${targetPath}.tmp`
  writeFileSync(temporaryPath, content)
  rmSync(targetPath, { force: true })
  renameSync(temporaryPath, targetPath)
}

function checkGenerated(expected) {
  const problems = []
  if (!existsSync(PACKAGE_PATH)) problems.push('missing generated ZIP')
  else if (!readFileSync(PACKAGE_PATH).equals(expected.zipBuffer)) problems.push('generated ZIP is stale')
  if (!existsSync(SIDECAR_PATH)) problems.push('missing generated sidecar manifest')
  else if (readFileSync(SIDECAR_PATH, 'utf8') !== expected.sidecarText) problems.push('generated sidecar manifest is stale')
  if (problems.length) fail(problems.join('; '))
}

function main() {
  if (process.argv.includes('--benchmark-candidates')) {
    const candidates = buildChartExamples(ROOT, { singleRendererPages: true })
    mkdirSync(path.dirname(BENCHMARK_PACKAGE_PATH), { recursive: true })
    replaceFileAtomically(BENCHMARK_PACKAGE_PATH, candidates.zipBuffer)
    console.log(`[chart-examples] generated benchmark candidates ${BENCHMARK_PACKAGE_PATH}`)
    return
  }

  const expected = buildChartExamples()
  if (process.argv.includes('--check')) {
    checkGenerated(expected)
    console.log(`[chart-examples] verified ${expected.sidecarText.length} manifest bytes and ${expected.zipBuffer.length} ZIP bytes`)
    return
  }
  replaceFileAtomically(PACKAGE_PATH, expected.zipBuffer)
  replaceFileAtomically(SIDECAR_PATH, expected.sidecarText)
  console.log(`[chart-examples] generated ${PACKAGE_PATH} (${expected.zipBuffer.length} bytes)`)
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : ''
if (entryPath === fileURLToPath(import.meta.url)) {
  try {
    main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
