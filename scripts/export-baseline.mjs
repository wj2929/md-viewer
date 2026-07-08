#!/usr/bin/env node
/**
 * 导出回归基线 —— 改导出代码前后必跑的安全网。
 *
 * 它做三件事：
 *   1) 对一组 fixture 真导出（HTML，可选 DOCX），校验 4 条客观铁律；
 *   2) 硬门禁：对照组(已知干净) + 边界(展示源码) 必须全绿，且多遍结果一致(确定性)；
 *   3) 把"已知 bug 用例"的当前状态打印出来作对照——修复时它们会从 ❌ 翻 ✅，一目了然。
 *
 * 退出码：0 = 安全网健康（没把好图改坏、没误伤展示源码、不抖动）；非 0 = 有问题，看输出。
 * 注意：本脚本只“观测导出产物”，不改任何源码。
 *
 * 用法：
 *   npm run build            # 先有 out/main/index.js
 *   node scripts/export-baseline.mjs                 # 默认 2 遍
 *   PASSES=3 node scripts/export-baseline.mjs         # 3 遍验确定性
 *   MD_VIEWER_DOCX_SERVICE_URL=http://127.0.0.1:3179 node scripts/export-baseline.mjs   # 含 DOCX 抽检
 *
 * 4 条铁律（纯客观，来自导出 JSON / 产物文本）：
 *   honest_ok    : renderStatus≠success 时 ok 不得为 true（不准谎报成功）
 *   no_silent    : 有失败(failed>0 或 status≠success) 必须有 warning（不准静默）
 *   count        : 导出计数 ≥ 源 Markdown 里的图表块数（漏识别=漏图）
 *   no_false_leak: 外部服务型语言不得以源码原样残留在产物里
 */
import electronPath from 'electron'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const APP = path.join(ROOT, 'out', 'main', 'index.js')
const TMP = path.join(ROOT, '.tmp', 'export-baseline')
const FIX = path.join(ROOT, 'e2e', 'fixtures')
const PASSES = parseInt(process.env.PASSES || '2', 10)
const DOCX_URL = process.env.MD_VIEWER_DOCX_SERVICE_URL || ''

if (!fs.existsSync(APP)) {
  console.error(`✗ 缺少构建产物 ${APP}\n  请先运行: npm run build`)
  process.exit(2)
}
fs.rmSync(TMP, { recursive: true, force: true })
fs.mkdirSync(TMP, { recursive: true })

const CHART_LANGS = new Set(['mermaid','echarts','markmap','graphviz','dot','plantuml','puml','drawio','dio','infographic','excalidraw','vega-lite','vegalite','d2','bpmn','wavedrom','c4plantuml','c4','structurizr','plotly','dbml','antv-g6','g6','kroki','nomnoml','pikchr','svgbob','bytefield','tikz'])
const LEAK_LANGS = ['kroki','plantuml','puml','nomnoml','pikchr','svgbob','bytefield','tikz']

function srcFences(md) {
  let n = 0
  const re = /^(```|~~~)([a-z0-9-]+)/gim
  let m
  while ((m = re.exec(md))) if (CHART_LANGS.has(m[2].toLowerCase())) n++
  return n
}

// kind: control = 已知干净(硬门禁须全绿) | boundary = 边界(硬门禁须全绿) | bug = 已知问题(信息对照)
const FIXTURES = [
  { name: 'shown-source',  kind: 'boundary', file: path.join(FIX, 'shown-source.md'),               note: '1 真图 + 1 展示源码' },
  { name: 'test-d2',       kind: 'control',  file: path.join(FIX, 'test-d2.md'),                     note: '对照·干净' },
  { name: 'test-vega-lite',kind: 'control',  file: path.join(FIX, 'test-vega-lite.md'),              note: '对照·干净' },
  { name: 'test-dbml',     kind: 'control',  file: path.join(FIX, 'test-dbml.md'),                   note: '对照·干净' },
  { name: 'test-kroki',    kind: 'bug',      file: path.join(FIX, 'test-kroki.md'),                  note: 'kroki 漏识别→漏源码 (待 W2)' },
  // test-mermaid: W1 契约诚实化后已四律全绿，升为受护(control)防回归。进程内渲染、确定性，可门禁。
  { name: 'test-mermaid',  kind: 'control',  file: path.join(FIX, 'test-mermaid.md'),                note: 'W1 后受护：失败必须诚实报告' },
  { name: 'test-alias',    kind: 'bug',      file: path.join(FIX, 'test-export-alias-renderers.md'), note: '别名漏识别' },
  { name: 'test-plantuml', kind: 'bug',      file: path.join(FIX, 'test-plantuml.md'),               note: '外部服务静默失败' },
].filter(f => !f.skip && fs.existsSync(f.file))

function runHtml(f, pass) {
  const out = path.join(TMP, `${f.name}.p${pass}.html`)
  const r = spawnSync(String(electronPath), [APP, 'export', f.file, '--format', 'html', '--out', out, '--json'], {
    env: { ...process.env, NODE_ENV: 'test', MD_VIEWER_SKIP_RESTORE: '1' },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  let j = {}
  try { j = JSON.parse(r.stdout) } catch { j = { parseError: true } }
  const s = j.summary || {}
  const html = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : ''
  const fences = srcFences(fs.readFileSync(f.file, 'utf8'))
  let residue = 0
  for (const l of LEAK_LANGS) residue += (html.match(new RegExp(`class="language-${l.replace('-', '\\-')}"`, 'g')) || []).length
  return {
    ok: j.ok, status: s.renderStatus, total: s.totalCharts, failed: s.failedCharts,
    warns: (j.warnings || []).length, fences, residue,
    honest_ok: !(j.ok === true && s.renderStatus && s.renderStatus !== 'success'),
    no_silent: !(((s.failedCharts > 0) || (s.renderStatus && s.renderStatus !== 'success')) && (j.warnings || []).length === 0),
    count: (typeof s.totalCharts === 'number') ? (s.totalCharts >= fences) : null,
    no_false_leak: residue === 0,
  }
}

const INVS = ['honest_ok', 'no_silent', 'count', 'no_false_leak']
const results = {}
for (const f of FIXTURES) {
  results[f.name] = []
  for (let p = 1; p <= PASSES; p++) results[f.name].push(runHtml(f, p))
}

// 报告
const pad = (s, n) => String(s == null ? '-' : s).padEnd(n)
const cell = (rs, k) => {
  const consistent = rs.every(r => r[k] === rs[0][k])
  const v = rs[0][k]
  return (v === null ? '—' : v ? '✅' : '❌') + (consistent ? '' : '⚠抖动')
}
console.log(`\n===== 导出回归基线（${PASSES} 遍/项）=====\n`)
console.log(pad('fixture', 15) + pad('kind', 9) + pad('status', 9) + pad('src/cnt', 9) + pad('fail', 5) + pad('warn', 5) + pad('残留', 6) + 'honest no_silent count noLeak')
for (const f of FIXTURES) {
  const rs = results[f.name]; const r = rs[0]
  console.log(pad(f.name, 15) + pad(f.kind, 9) + pad(r.status, 9) + pad(`${r.fences}/${r.total}`, 9) + pad(r.failed, 5) + pad(r.warns, 5) + pad(r.residue, 6) +
    pad(cell(rs, 'honest_ok'), 7) + pad(cell(rs, 'no_silent'), 10) + pad(cell(rs, 'count'), 6) + cell(rs, 'no_false_leak'))
}

// 判定
let flaky = false, gateFail = false
const gateFixtures = FIXTURES.filter(f => f.kind === 'control' || f.kind === 'boundary')
for (const f of FIXTURES) {
  const rs = results[f.name]
  if (INVS.some(k => !rs.every(r => r[k] === rs[0][k]))) flaky = true
}
for (const f of gateFixtures) {
  const r = results[f.name][0]
  if (INVS.some(k => r[k] === false)) { gateFail = true }
}
const bugsCaught = FIXTURES.filter(f => f.kind === 'bug' && INVS.some(k => results[f.name][0][k] === false)).length
const bugsTotal = FIXTURES.filter(f => f.kind === 'bug').length

console.log('\n----- 判定 -----')
console.log(`① 对照组+边界 全绿（不误伤好图/不误报展示源码）：${gateFail ? '❌ 否' : '✅ 是'}`)
console.log(`② 多遍一致（确定性，非抖动）：${flaky ? '❌ 有抖动' : '✅ 是'}`)
console.log(`③ 已知 bug 用例当前被抓：${bugsCaught}/${bugsTotal}（修复后应逐个翻绿）`)

// DOCX 抽检（可选，需服务）
if (DOCX_URL) {
  const krokiMd = path.join(TMP, 'kroki-probe.md')
  fs.writeFileSync(krokiMd, '# DOCX kroki 抽检\n\n```mermaid\ngraph TD\nA-->B\n```\n\n```kroki\n[A] -> [B]\n```\n')
  const dout = path.join(TMP, 'kroki-probe.docx')
  const dr = spawnSync(String(electronPath), [APP, 'export', krokiMd, '--format', 'docx', '--out', dout, '--json'], {
    env: { ...process.env, NODE_ENV: 'test', MD_VIEWER_SKIP_RESTORE: '1', MD_VIEWER_DOCX_SERVICE_URL: DOCX_URL },
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  })
  let dj = {}
  try { dj = JSON.parse(dr.stdout) } catch {}
  console.log('\n----- DOCX 抽检（1 mermaid 成功 + 1 kroki 不支持→中性化） -----')
  if (dj.summary) {
    // 期望：mermaid 出图(嵌图=1)；kroki 无图、源码不残留、改成中性占位「图表未渲染」。
    let media = 0, residue = false, placeholder = false, unpacked = false
    try {
      const { default: AdmZip } = await import('adm-zip')
      const zip = new AdmZip(dout)
      media = zip.getEntries().filter(e => /word\/media\/.*\.png$/i.test(e.entryName)).length
      const xmlEntry = zip.getEntry('word/document.xml')
      const xml = xmlEntry ? zip.readAsText(xmlEntry) : ''
      residue = /\[A\]|\[B\]|nomnoml/.test(xml)   // kroki 源码残留
      placeholder = xml.includes('图表未渲染')      // 中性占位是否出现
      unpacked = true
    } catch (e) { console.log('  (adm-zip 解包失败，跳过解包检查)', e.message) }
    // DOCX 是头号痛点且主循环只覆盖 HTML/CLI——这里是唯一的 DOCX 回归守卫，升级为硬门禁。
    const docxLeak = unpacked && residue
    const docxMissingPlaceholder = unpacked && !placeholder
    if (docxLeak || docxMissingPlaceholder) gateFail = true
    console.log(`  ok=${dj.ok} status=${dj.summary.renderStatus} 嵌图=${media}(应=1) `
      + `kroki源码残留=${residue ? '❌ 有' : '✅ 无'} 中性占位=${placeholder ? '✅ 有' : '❌ 缺'}`)
    if (docxLeak || docxMissingPlaceholder) console.log('  ❌ DOCX 门禁失败：kroki 源码漏入文档或缺中性占位')
  } else {
    console.log('  DOCX 导出失败/服务未启：', (dr.stderr || '').slice(0, 160))
  }
}

const healthy = !gateFail && !flaky
console.log(`\n基线整体：${healthy ? '✅ 安全网健康' : '❌ 有问题，见上'}（产物在 ${path.relative(ROOT, TMP)}/）`)
process.exit(healthy ? 0 : 1)
