# DOCX Preview Chart Export Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 `test-all-charts.md` 按 preview 格式导出 DOCX 时的图表漏渲染、图片过大、空白页、源码泄漏和公式视觉不一致问题。

**Architecture:** 客户端 `md-viewer` 继续负责把浏览器侧可渲染图表转成 PNG 并替换 Markdown 占位符；服务端 `md-viewer-docx-service` 只负责 Markdown 转 DOCX 和图片注入。尺寸策略从“固定宽度 + 服务端强行放大”改为“客户端按图片自然宽高比计算建议宽度，服务端尊重建议宽度并只做上限裁剪”。

**Tech Stack:** Electron + React + Vitest + Playwright；FastAPI + python-docx + pytest；LibreOffice/PDF 工具用于人工回归审计。

---

## 约束与验收标准

- 全程不主动 `git commit`；只有用户明确要求时再提交。
- 不使用 `5173` 端口；如需开发服务，改用空闲端口，例如 `5187`。
- `/Users/mac/Documents/test/testmd/md-viewer/e2e/fixtures/test-all-charts.md` 是本次综合回归源文件。
- DOCX 转 PDF 后不应出现由图表撑出的空白页。
- DOCX 文本中不应残留 `infographic ` 或 `<mxGraphModel` 源码。
- DOCX 中任意图表图片插入高度不应超过 `26cm`；推荐控制在 `24cm` 内，给标题和段间距留空间。
- `1.1 流程图（TD）`、`1.5 状态图`、`1.8 ER 图`、`4.2 渲染管线`、`4.8 网络拓扑` 不应再以 `18.5cm` 宽撑满页面。
- PDF 导出不在本轮改动目标内，但对比时应确认 PDF 没有因共享代码回归。

## 文件结构

- Modify: `md-viewer/src/renderer/src/utils/docxChartRenderer.ts`
  - 增加 `infographic` / `dio` 支持。
  - 生成 PNG 后读取自然尺寸，并计算 DOCX 插入宽度。
  - `ChartImage` 保持兼容，只新增内部 helper，不扩大服务端协议到必须字段。
- Modify: `md-viewer/src/renderer/src/utils/infographicRenderer.ts`
  - 导出 `renderInfographicToSvg`，供 DOCX 管线调用。
- Modify: `md-viewer/src/renderer/test/utils/docxChartRenderer.safe-padding.test.ts`
  - 增加 `infographic`、`dio`、尺寸计算测试。
- Modify: `md-viewer-docx-service/app/image_injector.py`
  - preview 不再把 `<18cm` 的图片强制放大到 `18.5cm`。
  - 注入图片时对最终宽度只做页面上限裁剪。
- Modify: `md-viewer-docx-service/tests/test_image_injector.py`
  - 更新旧断言，并增加 preview 尊重客户端小宽度的测试。
- Optional Modify: `md-viewer-docx-service/app/main.py`
  - 本轮先保留服务端公式渲染行为，只把 KaTeX preview 不一致列为后续任务；除非实现客户端公式截图，否则不要混入本轮。

---

### Task 1: 先用测试锁定服务端 preview 不应强制放大图片

**Files:**
- Modify: `md-viewer-docx-service/tests/test_image_injector.py`
- Modify: `md-viewer-docx-service/app/image_injector.py`

- [ ] **Step 1: 写失败测试**

在 `md-viewer-docx-service/tests/test_image_injector.py` 的 `TestImageWidth` 中，把旧的 preview 断言改成下面内容：

```python
class TestImageWidth:
    def test_preview_respects_client_image_width_without_forced_enlarge(self):
        from app.image_injector import resolve_image_width_cm

        assert resolve_image_width_cm(9.0, style="preview") == 9.0
        assert resolve_image_width_cm(15.5, style="preview") == 15.5
        assert resolve_image_width_cm(20.0, style="preview") == 19.0
        assert resolve_image_width_cm(15.5, style="standard") == 15.5
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
cd /Users/mac/Documents/test/testmd/md-viewer-docx-service
PYTHONPATH=. pytest tests/test_image_injector.py::TestImageWidth::test_preview_respects_client_image_width_without_forced_enlarge -q
```

Expected: FAIL，当前 `resolve_image_width_cm(15.5, style="preview")` 返回 `18.5`。

- [ ] **Step 3: 实现最小修复**

修改 `md-viewer-docx-service/app/image_injector.py` 的 `resolve_image_width_cm`：

```python
def resolve_image_width_cm(width_cm: float, style: str = "standard", layout: Optional[ImageLayout] = None) -> float:
    """根据导出样式解析图片插入宽度。"""
    if layout is not None:
        resolved = min(width_cm, layout.max_width_cm)
        should_enlarge = (
            layout.min_width_cm
            and width_cm >= layout.min_width_source_threshold_cm
            and resolved < layout.min_width_cm
        )
        if should_enlarge:
            resolved = min(layout.min_width_cm, layout.max_width_cm)
        return resolved

    if style == "preview":
        return min(width_cm, 19.0)
    return width_cm
```

- [ ] **Step 4: 运行服务端图片测试**

Run:

```bash
cd /Users/mac/Documents/test/testmd/md-viewer-docx-service
PYTHONPATH=. pytest tests/test_image_injector.py -q
```

Expected: PASS。

- [ ] **Step 5: 暂不提交**

不要运行 `git commit`。记录待提交文件即可：

```bash
git -C /Users/mac/Documents/test/testmd/md-viewer-docx-service status --short
```

---

### Task 2: 客户端按 PNG 自然尺寸计算 DOCX 插入宽度

**Files:**
- Modify: `md-viewer/src/renderer/src/utils/docxChartRenderer.ts`
- Modify: `md-viewer/src/renderer/test/utils/docxChartRenderer.safe-padding.test.ts`

- [ ] **Step 1: 写尺寸 helper 的失败测试**

在 `md-viewer/src/renderer/test/utils/docxChartRenderer.safe-padding.test.ts` 顶部 import 增加 `calculateDocxImageWidthCm`：

```ts
import { addSvgSafePaddingForDocx, calculateDocxChartTrimRect, calculateDocxImageWidthCm, renderChartsForDocx } from '../../src/utils/docxChartRenderer'
```

增加测试：

```ts
describe('DOCX chart image sizing', () => {
  it('keeps normal landscape charts within the maximum content width', () => {
    expect(calculateDocxImageWidthCm(1600, 900)).toBe(15.5)
  })

  it('shrinks tall charts so their inserted height does not exceed the page budget', () => {
    const widthCm = calculateDocxImageWidthCm(2348, 7790)
    expect(widthCm).toBeCloseTo(7.23, 1)
    expect(widthCm * (7790 / 2348)).toBeLessThanOrEqual(24.1)
  })

  it('does not enlarge tiny charts beyond the normal chart width', () => {
    expect(calculateDocxImageWidthCm(400, 120)).toBe(15.5)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
cd /Users/mac/Documents/test/testmd/md-viewer
npm test -- src/renderer/test/utils/docxChartRenderer.safe-padding.test.ts --run
```

Expected: FAIL，`calculateDocxImageWidthCm` 尚未导出。

- [ ] **Step 3: 增加 helper**

在 `md-viewer/src/renderer/src/utils/docxChartRenderer.ts` 常量区加入：

```ts
const DOCX_CHART_MAX_WIDTH_CM = 15.5
const DOCX_CHART_MAX_HEIGHT_CM = 24
```

在 trim helper 附近加入并导出：

```ts
export function calculateDocxImageWidthCm(pixelWidth: number, pixelHeight: number): number {
  if (!Number.isFinite(pixelWidth) || !Number.isFinite(pixelHeight) || pixelWidth <= 0 || pixelHeight <= 0) {
    return DOCX_CHART_MAX_WIDTH_CM
  }

  const heightToWidthRatio = pixelHeight / pixelWidth
  const widthByHeightBudget = DOCX_CHART_MAX_HEIGHT_CM / heightToWidthRatio
  const widthCm = Math.min(DOCX_CHART_MAX_WIDTH_CM, widthByHeightBudget)
  return Math.max(4, Number(widthCm.toFixed(2)))
}
```

- [ ] **Step 4: 让 PNG 渲染结果携带尺寸**

把 `renderChartCodeToPng` 返回类型从：

```ts
): Promise<{ pngBase64: string } | null> {
```

改成：

```ts
): Promise<{ pngBase64: string; widthCm: number } | null> {
```

新增读取 PNG 尺寸的 helper：

```ts
async function getPngNaturalSize(pngBase64: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve({
      width: img.naturalWidth || img.width,
      height: img.naturalHeight || img.height,
    })
    img.onerror = () => resolve(null)
    img.src = `data:image/png;base64,${pngBase64}`
  })
}
```

在 `renderChartCodeToPng` 末尾替换：

```ts
const pngBase64 = await svgToPng(svgString!, type, globalIndex)
if (pngBase64) return { pngBase64 }
```

为：

```ts
const pngBase64 = await svgToPng(svgString!, type, globalIndex)
if (pngBase64) {
  const size = await getPngNaturalSize(pngBase64)
  return {
    pngBase64,
    widthCm: size ? calculateDocxImageWidthCm(size.width, size.height) : DOCX_CHART_MAX_WIDTH_CM,
  }
}
```

- [ ] **Step 5: 使用动态宽度替代固定 15.5**

在 `renderChartsForDocx` 中，把代码块图片 push 从：

```ts
images.push({
  id: placeholderId,
  pngBase64: result.pngBase64,
  widthCm: 15.5,
})
```

改成：

```ts
images.push({
  id: placeholderId,
  pngBase64: result.pngBase64,
  widthCm: result.widthCm,
})
```

把 Excalidraw 文件引用图片 push 从：

```ts
images.push({ id: placeholderId, pngBase64: png.pngBase64, widthCm: 15.5 })
```

改成：

```ts
images.push({ id: placeholderId, pngBase64: png.pngBase64, widthCm: png.widthCm })
```

- [ ] **Step 6: 运行客户端单测**

Run:

```bash
cd /Users/mac/Documents/test/testmd/md-viewer
npm test -- src/renderer/test/utils/docxChartRenderer.safe-padding.test.ts --run
```

Expected: PASS。

- [ ] **Step 7: 暂不提交**

```bash
git -C /Users/mac/Documents/test/testmd/md-viewer status --short
```

---

### Task 3: 接入 Infographic 到 DOCX 图表管线

**Files:**
- Modify: `md-viewer/src/renderer/src/utils/infographicRenderer.ts`
- Modify: `md-viewer/src/renderer/src/utils/docxChartRenderer.ts`
- Modify: `md-viewer/src/renderer/test/utils/docxChartRenderer.safe-padding.test.ts`

- [ ] **Step 1: 写失败测试**

在测试文件顶部增加 mock：

```ts
const mockRenderInfographicToSvg = vi.hoisted(() => vi.fn())

vi.mock('../../src/utils/infographicRenderer', async () => {
  const actual = await vi.importActual<typeof import('../../src/utils/infographicRenderer')>('../../src/utils/infographicRenderer')
  return {
    ...actual,
    renderInfographicToSvg: mockRenderInfographicToSvg,
  }
})
```

在 `beforeEach` 中增加：

```ts
mockRenderInfographicToSvg.mockResolvedValue('<svg viewBox="0 0 800 600"><rect width="800" height="600"></rect></svg>')
```

增加测试：

```ts
it('DOCX 图表管线识别 infographic 代码块并替换为图片占位符', async () => {
  const result = await renderChartsForDocx('```infographic\nlist-row-simple-horizontal-arrow\ndata\n  title 产品开发流程\n```')

  expect(mockRenderInfographicToSvg).toHaveBeenCalled()
  expect(result.images.length).toBe(1)
  expect(result.modifiedMarkdown).toMatch(/!\[\]\(mdv__chart__/)
  expect(result.modifiedMarkdown).not.toContain('```infographic')
})
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
cd /Users/mac/Documents/test/testmd/md-viewer
npm test -- src/renderer/test/utils/docxChartRenderer.safe-padding.test.ts --run
```

Expected: FAIL，当前 `infographic` 不在 `CHART_LANGS`。

- [ ] **Step 3: 导出 Infographic SVG 渲染函数**

修改 `md-viewer/src/renderer/src/utils/infographicRenderer.ts` 文件末尾：

```ts
export { Infographic, validateInfographicConfig, renderInfographicToSvg, processInfographicInHtml }
```

- [ ] **Step 4: DOCX 管线增加 infographic 类型**

在 `md-viewer/src/renderer/src/utils/docxChartRenderer.ts` 中修改类型和集合：

```ts
type ChartType = 'echarts' | 'mermaid' | 'dot' | 'graphviz' | 'markmap' | 'plantuml' | 'drawio' | 'excalidraw' | 'infographic'
```

```ts
const CHART_LANGS = new Set<string>([
  'echarts', 'mermaid', 'dot', 'graphviz', 'markmap', 'plantuml', 'drawio', 'dio', 'excalidraw', 'excalidraw-json', 'infographic',
])
```

```ts
const CONTAINER_CLASS_MAP: Record<string, string> = {
  mermaid: 'mermaid-container',
  echarts: 'echarts-container',
  dot: 'graphviz-container',
  graphviz: 'graphviz-container',
  markmap: 'markmap-container',
  plantuml: 'plantuml-container',
  drawio: 'drawio-container',
  excalidraw: 'excalidraw-container',
  infographic: 'infographic-container',
}
```

在 `renderChartCodeToPng` 的 switch 中增加：

```ts
case 'infographic': {
  const { renderInfographicToSvg } = await import('./infographicRenderer')
  svgString = await renderInfographicToSvg(code, `docx-export-${globalIndex}`)
  break
}
```

- [ ] **Step 5: 运行客户端单测**

Run:

```bash
cd /Users/mac/Documents/test/testmd/md-viewer
npm test -- src/renderer/test/utils/docxChartRenderer.safe-padding.test.ts --run
```

Expected: PASS。

---

### Task 4: 接入 dio 别名到 DOCX DrawIO 管线

**Files:**
- Modify: `md-viewer/src/renderer/src/utils/docxChartRenderer.ts`
- Modify: `md-viewer/src/renderer/test/utils/docxChartRenderer.safe-padding.test.ts`

- [ ] **Step 1: 写失败测试**

增加测试：

```ts
it('DOCX 图表管线将 dio 别名归一为 drawio 并使用 DrawIO DOM fallback', async () => {
  document.body.innerHTML = [
    '<div class="markdown-body">',
    '<div class="drawio-container"><svg viewBox="0 0 300 120"><rect width="300" height="120"></rect></svg></div>',
    '</div>',
  ].join('')

  const result = await renderChartsForDocx('```dio\n<mxGraphModel><root></root></mxGraphModel>\n```')

  expect(result.images.length).toBe(1)
  expect(result.modifiedMarkdown).toMatch(/!\[\]\(mdv__chart__/)
  expect(result.modifiedMarkdown).not.toContain('<mxGraphModel')
})
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
cd /Users/mac/Documents/test/testmd/md-viewer
npm test -- src/renderer/test/utils/docxChartRenderer.safe-padding.test.ts --run
```

Expected: FAIL，当前 `dio` 不在 `CHART_LANGS`。

- [ ] **Step 3: 归一化 dio**

修改 `normalizeChartType`：

```ts
function normalizeChartType(lang: string): ChartType {
  if (lang === 'graphviz') return 'dot'
  if (lang === 'excalidraw-json') return 'excalidraw'
  if (lang === 'dio') return 'drawio'
  return lang as ChartType
}
```

确认 Task 3 中 `CHART_LANGS` 已包含 `dio`。

- [ ] **Step 4: 运行客户端单测**

Run:

```bash
cd /Users/mac/Documents/test/testmd/md-viewer
npm test -- src/renderer/test/utils/docxChartRenderer.safe-padding.test.ts --run
```

Expected: PASS。

---

### Task 5: 用综合产物回归验证 `test-all-charts.md`

**Files:**
- Read: `/Users/mac/Documents/test/testmd/md-viewer/e2e/fixtures/test-all-charts.md`
- Read/Generate: `/Users/mac/Documents/tmp/test-all-charts.docx`
- Generate: `/tmp/mdv-docx-pdf/test-all-charts.pdf`
- Generate: `/tmp/mdv-docx-pages-full/contact.png`

- [ ] **Step 1: 启动服务和应用**

如果需要运行 Electron 开发服务，使用非 `5173` 端口：

```bash
cd /Users/mac/Documents/test/testmd/md-viewer
VITE_PORT=5187 npm run dev
```

DOCX 服务使用现有 `3179`，如需重启：

```bash
cd /Users/mac/Documents/test/testmd/md-viewer-docx-service
PYTHONPATH=. uvicorn app.main:app --host 127.0.0.1 --port 3179
```

- [ ] **Step 2: 从应用导出 DOCX**

在应用中打开：

```text
/Users/mac/Documents/test/testmd/md-viewer/e2e/fixtures/test-all-charts.md
```

按 `preview` 样式导出 DOCX 到：

```text
/Users/mac/Documents/tmp/test-all-charts.docx
```

- [ ] **Step 3: 转 PDF 并统计页数**

Run:

```bash
mkdir -p /tmp/mdv-docx-pdf
soffice --headless --convert-to pdf --outdir /tmp/mdv-docx-pdf /Users/mac/Documents/tmp/test-all-charts.docx
pdfinfo /tmp/mdv-docx-pdf/test-all-charts.pdf | sed -n '1,25p'
```

Expected: 能成功转换；页数不再由空白页异常膨胀。

- [ ] **Step 4: 检查源码泄漏**

Run:

```bash
pdftotext -layout /tmp/mdv-docx-pdf/test-all-charts.pdf - | rg -n "infographic |<mxGraphModel|```"
```

Expected: 无匹配输出。

- [ ] **Step 5: 检查 DOCX 图片尺寸**

Run:

```bash
python3 - <<'PY'
import zipfile, xml.etree.ElementTree as ET
ns={'wp':'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'}
with zipfile.ZipFile('/Users/mac/Documents/tmp/test-all-charts.docx') as z:
    root=ET.fromstring(z.read('word/document.xml'))
bad=[]
for idx, ex in enumerate(root.findall('.//wp:extent', ns), 1):
    cx=int(ex.attrib['cx'])/360000
    cy=int(ex.attrib['cy'])/360000
    if cy > 26:
        bad.append((idx, round(cx, 2), round(cy, 2)))
print('bad_extents=', bad)
raise SystemExit(1 if bad else 0)
PY
```

Expected: `bad_extents= []`。

- [ ] **Step 6: 生成全页缩略图人工审计**

Run:

```bash
rm -rf /tmp/mdv-docx-pages-full
mkdir -p /tmp/mdv-docx-pages-full
pdftoppm -png -r 72 /tmp/mdv-docx-pdf/test-all-charts.pdf /tmp/mdv-docx-pages-full/page
magick montage /tmp/mdv-docx-pages-full/page-*.png -thumbnail 180x255 -label '%f' -tile 6x -geometry +8+20 /tmp/mdv-docx-pages-full/contact.png
```

人工打开：

```text
/tmp/mdv-docx-pages-full/contact.png
```

Expected: 前两页不再大片空白；Mermaid、ECharts、Markmap、Graphviz、Infographic、DrawIO 都能看到图形；没有明显空白页。

---

### Task 6: 自动化测试总跑

**Files:**
- No direct source change.

- [ ] **Step 1: 跑 md-viewer 类型检查和相关单测**

Run:

```bash
cd /Users/mac/Documents/test/testmd/md-viewer
npm run typecheck
npm test -- src/renderer/test/utils/docxChartRenderer.safe-padding.test.ts --run
```

Expected: PASS。

- [ ] **Step 2: 跑 docx-service pytest**

Run:

```bash
cd /Users/mac/Documents/test/testmd/md-viewer-docx-service
PYTHONPATH=. pytest tests/test_image_injector.py tests/test_preview_style_visual_metrics.py -q
```

Expected: PASS。

- [ ] **Step 3: 检查工作区变更**

Run:

```bash
git -C /Users/mac/Documents/test/testmd/md-viewer status --short
git -C /Users/mac/Documents/test/testmd/md-viewer-docx-service status --short
```

Expected: 只出现本计划列出的文件变更和重新生成的临时产物；不要包含无关文件。

- [ ] **Step 4: 不主动提交**

等待用户明确说“commit”后再提交。若用户要求提交，建议分两个 commit：

```bash
git -C /Users/mac/Documents/test/testmd/md-viewer add src/renderer/src/utils/docxChartRenderer.ts src/renderer/src/utils/infographicRenderer.ts src/renderer/test/utils/docxChartRenderer.safe-padding.test.ts
git -C /Users/mac/Documents/test/testmd/md-viewer commit -m "fix: 修复 DOCX preview 图表渲染和尺寸"

git -C /Users/mac/Documents/test/testmd/md-viewer-docx-service add app/image_injector.py tests/test_image_injector.py
git -C /Users/mac/Documents/test/testmd/md-viewer-docx-service commit -m "fix: DOCX preview 尊重图表图片宽度"
```

---

## 后续任务，不混入本轮

- KaTeX preview 一致性：客户端从已渲染 KaTeX DOM 截图，或服务端改成真正 KaTeX/MathML 渲染；本轮只记录问题，不与图表尺寸修复混合。
- 更精确的自动 E2E：为 DOCX 导出增加专门 Playwright 流程，自动打开 `test-all-charts.md`、导出 DOCX、转 PDF、检查源码泄漏和图片尺寸。
- 视觉阈值快照：保存 `contact.png` 作为人工参考，不建议直接做像素级快照，因为 LibreOffice/字体渲染在不同机器上波动较大。

## 自检

- 覆盖漏渲染：Task 3 覆盖 `infographic`，Task 4 覆盖 `dio`。
- 覆盖尺寸失控：Task 1 阻止服务端强行放大，Task 2 按 PNG 高宽比控制高度。
- 覆盖前两页空白：Task 5 使用全页缩略图和高度阈值验证。
- 覆盖源码泄漏：Task 5 用 `pdftotext | rg` 检查。
- 符合用户约束：计划明确不使用 `5173`，不主动 commit。
