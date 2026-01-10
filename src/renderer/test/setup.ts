// @ts-nocheck - 测试文件的类型检查暂时跳过
import { expect, afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import '@testing-library/jest-dom'

// 每次测试后清理
afterEach(() => {
  cleanup()
})

// Mock window.matchMedia
global.window.matchMedia = vi.fn().mockImplementation(query => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: vi.fn(),
  removeListener: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn()
}))

// Mock Electron API
global.window.electronAPI = {
  openFolder: vi.fn(),
  readDir: vi.fn(),
  readFile: vi.fn(),
  exportHtml: vi.fn(),
  exportPdf: vi.fn(),
  getLastOpenedFolder: vi.fn(),
  saveLastOpenedFolder: vi.fn(),
  onThemeChange: vi.fn()
}

// Mock Prism 全局对象和所有语言组件
global.Prism = {
  highlight: vi.fn((code: string) => code),
  highlightAll: vi.fn(),
  highlightElement: vi.fn(),
  languages: {
    javascript: {},
    typescript: {},
    jsx: {},
    tsx: {},
    python: {},
    java: {},
    go: {},
    rust: {},
    bash: {},
    json: {},
    yaml: {},
    markdown: {},
    css: {}
  },
  util: {
    escapeHtml: vi.fn((str: string) => str.replace(/[&<>"']/g, (m) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[m] || m)))
  }
}

// Mock prismjs 模块
vi.mock('prismjs', () => ({
  default: global.Prism
}))

// Mock prismjs 语言组件
vi.mock('prismjs/components/prism-javascript', () => ({}))
vi.mock('prismjs/components/prism-typescript', () => ({}))
vi.mock('prismjs/components/prism-jsx', () => ({}))
vi.mock('prismjs/components/prism-tsx', () => ({}))
vi.mock('prismjs/components/prism-python', () => ({}))
vi.mock('prismjs/components/prism-java', () => ({}))
vi.mock('prismjs/components/prism-go', () => ({}))
vi.mock('prismjs/components/prism-rust', () => ({}))
vi.mock('prismjs/components/prism-bash', () => ({}))
vi.mock('prismjs/components/prism-json', () => ({}))
vi.mock('prismjs/components/prism-yaml', () => ({}))
vi.mock('prismjs/components/prism-markdown', () => ({}))
vi.mock('prismjs/components/prism-css', () => ({}))

// Mock KaTeX
vi.mock('katex', () => ({
  default: {
    render: vi.fn(),
    renderToString: vi.fn((tex: string) => `<span class="katex">${tex}</span>`)
  }
}))

// Mock Mermaid
vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn().mockResolvedValue({ svg: '<svg>mermaid diagram</svg>' })
  }
}))
