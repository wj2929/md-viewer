/**
 * 导出样式模块 - 供 GUI（exportHandlers）与 CLI（exportCommand）共享。
 *
 * 从 exportHandlers.ts 抽出，原因：exportHandlers.ts 顶层直接 ipcMain.handle(...)，
 * CLI 若 import 该模块会触发 IPC 注册副作用。样式读取逻辑本身与 IPC 无关，
 * 单独成模块后 CLI 可安全复用，避免 GUI/CLI 导出样式分叉。
 */

import { join } from 'path'
import { app } from 'electron'
import { is } from '@electron-toolkit/utils'
import * as fs from 'fs-extra'

export function sanitizeBundledExportCss(css: string): string {
  // 过滤掉应用程序的布局样式（这些样式会阻止导出 HTML 滚动）
  // 移除 body { overflow: hidden; height: 100vh; } 等应用布局样式
  return css
    // 移除 body 的 overflow: hidden 和 height: 100vh
    .replace(/body\s*\{[^}]*overflow\s*:\s*hidden[^}]*\}/g, (match) => {
      // 只移除 overflow: hidden 和 height: 100vh，保留其他样式
      return match
        .replace(/overflow\s*:\s*hidden\s*;?/g, '')
        .replace(/height\s*:\s*100vh\s*;?/g, '')
    })
    // 移除 #root, .app, .workspace-container 等应用容器样式
    .replace(/#root\s*\{[^}]*\}/g, '')
    .replace(/\.app\s*\{[^}]*\}/g, '')
    .replace(/\.workspace-container\s*\{[^}]*\}/g, '')
    .replace(/\.main-content\s*\{[^}]*\}/g, '')
    .replace(/\.sidebar\s*\{[^}]*\}/g, '')
    .replace(/\.titlebar\s*\{[^}]*\}/g, '')
    .replace(/\.header\s*\{[^}]*\}/g, '')
    // 移除文件树相关样式
    .replace(/\.file-tree[^{]*\{[^}]*\}/g, '')
    // 移除标签栏相关样式
    .replace(/\.tab-bar[^{]*\{[^}]*\}/g, '')
    .replace(/\.tab-item[^{]*\{[^}]*\}/g, '')
    // 移除导航栏相关样式
    .replace(/\.navigation-bar[^{]*\{[^}]*\}/g, '')
    .replace(/\.nav-[^{]*\{[^}]*\}/g, '')
    // 移除书签栏相关样式
    .replace(/\.bookmark-bar[^{]*\{[^}]*\}/g, '')
    .replace(/\.bookmark-panel[^{]*\{[^}]*\}/g, '')
    // 移除搜索相关样式
    .replace(/\.search-[^{]*\{[^}]*\}/g, '')
    // 移除设置面板相关样式
    .replace(/\.settings-[^{]*\{[^}]*\}/g, '')
}

export function hasCoreMarkdownExportCss(css: string): boolean {
  return /\.markdown-body\s*\{/.test(css) &&
    /\.markdown-body\s+blockquote\b/.test(css) &&
    /\.markdown-body\s+table\b/.test(css) &&
    /\.markdown-body\s+table\s+(td|th)\b/.test(css)
}

export async function getExportStyles(): Promise<{ markdownCss: string; prismCss: string }> {
  let markdownCss = ''
  let prismCss = ''

  try {
    // 开发环境路径
    if (is.dev) {
      const srcPath = join(__dirname, '../../src/renderer/src/assets')
      markdownCss = await fs.readFile(join(srcPath, 'markdown.css'), 'utf-8')
      prismCss = await fs.readFile(join(srcPath, 'prism-theme.css'), 'utf-8')
    } else {
      // 生产环境：尝试多个可能的路径
      const possiblePaths = [
        join(__dirname, '../renderer/assets'),
        join(__dirname, '../renderer'),
        join(app.getAppPath(), 'out/renderer/assets'),
        join(app.getAppPath(), 'out/renderer')
      ]

      for (const assetsPath of possiblePaths) {
        try {
          // 尝试直接读取文件
          markdownCss = await fs.readFile(join(assetsPath, 'markdown.css'), 'utf-8')
          prismCss = await fs.readFile(join(assetsPath, 'prism-theme.css'), 'utf-8')
          break
        } catch {
          // 尝试读取合并后的 CSS 文件（Vite 可能会重命名）
          try {
            const files = await fs.readdir(assetsPath)
            const cssFiles = files.filter(f => f.endsWith('.css')).sort((a, b) => {
              const score = (name: string): number => name.startsWith('katex') ? 0 : name.startsWith('index') ? 1 : 2
              return score(a) - score(b) || a.localeCompare(b)
            })
            if (cssFiles.length > 0) {
              const combinedCss = sanitizeBundledExportCss(
                (await Promise.all(cssFiles.map(file => fs.readFile(join(assetsPath, file), 'utf-8')))).join('\n')
              )
              if (!hasCoreMarkdownExportCss(combinedCss)) {
                continue
              }
              markdownCss = combinedCss
              prismCss = ''
              break
            }
          } catch {
            continue
          }
        }
      }
    }
  } catch (cssError) {
    console.error('Failed to read CSS files:', cssError)
  }

  // 如果仍然没有样式，使用内嵌的完整样式
  if (!markdownCss || !hasCoreMarkdownExportCss(markdownCss)) {
    markdownCss = getBuiltinMarkdownCSS()
    prismCss = getBuiltinPrismCSS()
  }

  return { markdownCss, prismCss }
}

// 内置的完整 Markdown 样式
export function getBuiltinMarkdownCSS(): string {
  return `
.markdown-body {
  font-family: 'Helvetica Neue', Helvetica, 'Segoe UI', Arial, freesans, sans-serif;
  font-size: 16px;
  line-height: 1.6;
  color: var(--text-primary);
  background-color: var(--bg-primary);
  word-wrap: break-word;
}

.markdown-body h1, .markdown-body h2, .markdown-body h3,
.markdown-body h4, .markdown-body h5, .markdown-body h6 {
  line-height: 1.2;
  margin-top: 1em;
  margin-bottom: 16px;
  color: var(--text-strong);
  font-weight: 600;
}

.markdown-body h1 { font-size: 2.25em; font-weight: 300; }
.markdown-body h2 { font-size: 1.75em; font-weight: 400; }
.markdown-body h3 { font-size: 1.5em; font-weight: 500; }
.markdown-body h4 { font-size: 1.25em; }
.markdown-body h5, .markdown-body h6 { font-size: 1em; }
.markdown-body h6 { color: var(--text-secondary); }

.markdown-body strong { color: var(--text-strong); font-weight: 600; }
.markdown-body a { color: #08c; text-decoration: none; }
.markdown-body a:hover { text-decoration: underline; }

.markdown-body p, .markdown-body ul, .markdown-body ol,
.markdown-body blockquote, .markdown-body table, .markdown-body pre {
  margin-bottom: 16px;
}

.markdown-body ul, .markdown-body ol { padding-left: 2em; }
.markdown-body li + li { margin-top: 0.25em; }

.markdown-body blockquote {
  padding: 0 1em;
  color: var(--text-secondary);
  border-left: 4px solid var(--blockquote-border);
  background: var(--blockquote-bg);
}

.markdown-body code {
  font-family: Consolas, "Liberation Mono", Menlo, Courier, monospace;
  font-size: 85%;
  background: var(--inline-code-bg);
  padding: 0.2em 0.4em;
  border-radius: 3px;
}

.markdown-body pre {
  padding: 16px;
  overflow: auto;
  font-size: 85%;
  line-height: 1.45;
  background: var(--code-block-bg);
  border-radius: 6px;
  border: 1px solid var(--border-color);
}

.markdown-body pre code {
  padding: 0;
  background: transparent;
  border-radius: 0;
}

.markdown-body table {
  border-collapse: collapse;
  width: 100%;
  /* 列多 + 单元格含长 URL/路径时，默认 table-layout:auto 会让某列撑爆导致最后列被裁。
     配合单元格 word-break，允许内容换行而不是撑宽列。 */
  word-break: break-word;
  overflow-wrap: anywhere;
}

.markdown-body th, .markdown-body td {
  padding: 6px 13px;
  border: 1px solid var(--border-color);
  word-break: break-word;
  overflow-wrap: anywhere;
}

.markdown-body th {
  font-weight: 600;
  background: var(--table-header-bg);
}

.markdown-body tr:nth-child(2n) {
  background: var(--bg-secondary);
}

.markdown-body hr {
  height: 0.25em;
  padding: 0;
  margin: 24px 0;
  background-color: var(--hr-color);
  border: 0;
}

.markdown-body img {
  max-width: 100%;
  box-sizing: content-box;
}

.markdown-body .katex-display {
  overflow-x: auto;
  overflow-y: hidden;
}
`
}

// 内置的 Prism 代码高亮样式
export function getBuiltinPrismCSS(): string {
  return `
code[class*="language-"], pre[class*="language-"] {
  color: var(--text-primary);
  font-family: Consolas, "Liberation Mono", Menlo, Courier, monospace;
  text-align: left;
  white-space: pre;
  word-spacing: normal;
  word-break: normal;
  line-height: 1.4;
  tab-size: 4;
}

.token.comment, .token.blockquote { color: #969896; }
.token.cdata { color: #183691; }
.token.doctype, .token.punctuation, .token.variable { color: var(--text-primary); }
.token.operator, .token.important, .token.keyword, .token.rule, .token.builtin { color: #a71d5d; }
.token.string, .token.url, .token.regex, .token.attr-value { color: #183691; }
.token.property, .token.number, .token.boolean, .token.entity, .token.atrule,
.token.constant, .token.symbol, .token.command, .token.code { color: #0086b3; }
.token.tag, .token.selector, .token.prolog { color: #63a35c; }
.token.function, .token.namespace, .token.pseudo-element, .token.class,
.token.class-name, .token.pseudo-class, .token.id, .token.url-reference .token.variable,
.token.attr-name { color: #795da3; }
.token.entity { cursor: help; }
.token.title, .token.title .token.punctuation { font-weight: bold; color: #1d3e81; }
.token.list { color: #ed6a43; }
.token.inserted { background-color: #eaffea; color: #55a532; }
.token.deleted { background-color: #ffecec; color: #bd2c00; }
.token.bold { font-weight: bold; }
.token.italic { font-style: italic; }
`
}
