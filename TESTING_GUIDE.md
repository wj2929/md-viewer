# MD Viewer 测试指南

> 如何为 MD Viewer 编写和运行测试

---

## 🚀 快速开始

```bash
# 运行所有测试
npm test

# 运行测试并监听文件变化
npm test -- --watch

# 生成覆盖率报告
npm run test:coverage

# UI 模式运行测试
npm run test:ui
```

---

## 📂 测试文件结构

```
md-viewer/
├── src/renderer/
│   ├── src/
│   │   └── components/          # 组件源代码
│   │       ├── FileTree.tsx
│   │       ├── MarkdownRenderer.tsx
│   │       └── SearchBar.tsx
│   └── test/
│       ├── setup.ts             # 测试环境配置
│       └── components/          # 组件测试
│           ├── FileTree.test.tsx
│           ├── MarkdownRenderer.test.tsx
│           └── SearchBar.test.tsx
├── vitest.config.ts             # Vitest 配置
└── TEST_REPORT.md               # 测试报告
```

---

## 🧪 编写测试

### 1. 组件测试模板

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { YourComponent } from '../../src/components/YourComponent'

describe('YourComponent', () => {
  beforeEach(() => {
    // 每次测试前清理
  })

  describe('基础渲染', () => {
    it('应该渲染组件', () => {
      render(<YourComponent />)
      expect(screen.getByText('Expected Text')).toBeInTheDocument()
    })
  })

  describe('用户交互', () => {
    it('应该响应点击事件', async () => {
      const handleClick = vi.fn()
      render(<YourComponent onClick={handleClick} />)

      await userEvent.click(screen.getByRole('button'))

      expect(handleClick).toHaveBeenCalledTimes(1)
    })
  })
})
```

### 2. 测试最佳实践

#### ✅ DO（推荐做法）
```typescript
// 1. 使用语义化查询
screen.getByRole('button', { name: /submit/i })
screen.getByLabelText('Email')
screen.getByText(/welcome/i)

// 2. 使用 userEvent 而不是 fireEvent
await userEvent.click(button)
await userEvent.type(input, 'text')

// 3. 等待异步操作
await waitFor(() => {
  expect(screen.getByText('Loaded')).toBeInTheDocument()
})

// 4. 测试用户可见的行为
expect(screen.getByText('Error')).toBeInTheDocument()

// 5. 使用 container 查询 DOM
const { container } = render(<Component />)
expect(container.querySelector('.class')).toBeInTheDocument()
```

#### ❌ DON'T（避免的做法）
```typescript
// 1. 不要直接测试 state 和 props
// ❌ expect(component.state.count).toBe(1)

// 2. 不要使用 querySelector 作为首选
// ❌ container.querySelector('#id')
// ✅ screen.getByRole('button')

// 3. 不要测试实现细节
// ❌ expect(mockFn).toHaveBeenCalledWith(internalValue)
// ✅ expect(screen.getByText('Result')).toBeInTheDocument()

// 4. 不要忽略异步操作
// ❌ click(); expect(result)
// ✅ await userEvent.click(); await waitFor(...)
```

---

## 🎭 Mock 策略

### 1. Electron API Mock

已在 `setup.ts` 中全局 Mock：

```typescript
global.window.electronAPI = {
  openFolder: vi.fn(),
  readDir: vi.fn(),
  readFile: vi.fn(),
  // ...
}
```

使用示例：

```typescript
it('应该调用 Electron API', async () => {
  const mockReadFile = vi.fn().mockResolvedValue('content')
  global.window.electronAPI.readFile = mockReadFile

  // 测试代码...

  expect(mockReadFile).toHaveBeenCalledWith('/path/to/file')
})
```

### 2. 第三方库 Mock

#### Prism.js (代码高亮)
```typescript
// 已在 setup.ts 中 Mock
global.Prism.highlight = vi.fn((code) => code)
```

#### KaTeX (数学公式)
```typescript
// 已在 setup.ts 中 Mock
vi.mock('katex', () => ({
  default: {
    renderToString: vi.fn((tex) => `<span class="katex">${tex}</span>`)
  }
}))
```

### 3. 自定义 Mock

```typescript
import { vi } from 'vitest'

// Mock 函数
const mockFn = vi.fn()
mockFn.mockReturnValue(42)
mockFn.mockResolvedValue('async result')

// Mock 模块
vi.mock('./module', () => ({
  default: vi.fn(),
  namedExport: vi.fn()
}))
```

---

## 🧩 测试工具 API

### @testing-library/react

#### 查询方法
```typescript
// 获取元素（找不到会抛错）
screen.getByRole('button')
screen.getByLabelText('Name')
screen.getByText(/hello/i)

// 查询元素（找不到返回 null）
screen.queryByRole('button')
screen.queryByText('Not Found')

// 查找元素（异步，等待元素出现）
await screen.findByRole('button')
await screen.findByText('Loaded')

// 获取所有匹配元素
screen.getAllByRole('listitem')
screen.queryAllByRole('listitem')
await screen.findAllByRole('listitem')
```

#### 用户交互
```typescript
import userEvent from '@testing-library/user-event'

// 点击
await userEvent.click(element)

// 输入文本
await userEvent.type(input, 'text')

// 清空输入
await userEvent.clear(input)

// 键盘操作
await userEvent.keyboard('{Enter}')
await userEvent.keyboard('{Escape}')

// 悬停
await userEvent.hover(element)
```

#### 断言
```typescript
import '@testing-library/jest-dom'

// 元素存在
expect(element).toBeInTheDocument()
expect(element).not.toBeInTheDocument()

// 可见性
expect(element).toBeVisible()
expect(element).not.toBeVisible()

// 属性
expect(element).toHaveAttribute('href', 'https://...')
expect(element).toHaveClass('active')

// 内容
expect(element).toHaveTextContent('text')
expect(element).toContainHTML('<span>text</span>')

// 表单
expect(input).toHaveValue('value')
expect(checkbox).toBeChecked()
expect(button).toBeDisabled()
```

---

## 🎯 测试覆盖率

### 查看覆盖率

```bash
npm run test:coverage
```

### 覆盖率目标

| 指标 | 目标 |
|------|------|
| 语句覆盖率 | ≥ 80% |
| 分支覆盖率 | ≥ 80% |
| 函数覆盖率 | ≥ 80% |
| 行覆盖率 | ≥ 80% |

### 覆盖率配置

在 `vitest.config.ts` 中配置：

```typescript
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/renderer/src/**/*.{ts,tsx}'],
      exclude: [
        'src/renderer/src/main.tsx',
        'src/renderer/src/**/*.d.ts',
        'src/renderer/test/**/*'
      ],
      lines: 80,
      functions: 80,
      branches: 80,
      statements: 80
    }
  }
})
```

---

## 🐛 调试测试

### 1. 使用 debug()

```typescript
import { render, screen } from '@testing-library/react'

it('debug test', () => {
  const { debug } = render(<Component />)

  // 打印整个 DOM
  debug()

  // 打印特定元素
  debug(screen.getByRole('button'))
})
```

### 2. 使用 screen.logTestingPlaygroundURL()

```typescript
it('playground test', () => {
  render(<Component />)

  // 生成 Testing Playground URL
  screen.logTestingPlaygroundURL()
})
```

### 3. 使用 Vitest UI

```bash
npm run test:ui
```

打开浏览器查看测试详情、覆盖率、时间线等。

---

## 📊 CI/CD 集成

测试在 GitHub Actions 中自动运行：

```yaml
- name: 运行单元测试
  run: npm test -- --run

- name: 生成覆盖率报告
  run: npm run test:coverage
```

**查看 CI 状态：** 在 Pull Request 中查看测试结果

---

## 🔧 常见问题

### Q: 测试中如何处理 Electron API？

A: Electron API 已在 `setup.ts` 中 Mock，直接使用即可：

```typescript
it('should use Electron API', async () => {
  global.window.electronAPI.readFile.mockResolvedValue('content')
  // 测试代码...
})
```

### Q: 如何测试异步操作？

A: 使用 `waitFor` 或 `findBy*` 查询：

```typescript
await waitFor(() => {
  expect(screen.getByText('Loaded')).toBeInTheDocument()
})

// 或
const element = await screen.findByText('Loaded')
expect(element).toBeInTheDocument()
```

### Q: 如何测试 CSS 类名？

A: 使用 `toHaveClass` 断言：

```typescript
expect(element).toHaveClass('active')
expect(element).toHaveClass('btn', 'btn-primary')
```

### Q: 测试运行很慢怎么办？

A: 使用 `--run` 参数避免 watch 模式：

```bash
npm test -- --run
```

或使用 `--reporter=dot` 简化输出：

```bash
npm test -- --run --reporter=dot
```

---

## 📚 参考资源

- [Vitest 官方文档](https://vitest.dev/)
- [Testing Library 官方文档](https://testing-library.com/)
- [Testing Library Cheatsheet](https://testing-library.com/docs/react-testing-library/cheatsheet)
- [Common Mistakes](https://kentcdodds.com/blog/common-mistakes-with-react-testing-library)

---

**最后更新：** 2026-01-02 23:18
