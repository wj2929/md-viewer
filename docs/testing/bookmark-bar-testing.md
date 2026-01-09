# BookmarkBar 测试运行指南

## 单元测试（React Testing Library + Jest）

### 运行所有单元测试
```bash
npm test
```

### 运行 BookmarkBar 单元测试
```bash
npm test -- BookmarkBar.test.tsx
```

### 运行测试并生成覆盖率报告
```bash
npm test -- --coverage --collectCoverageFrom='src/renderer/src/components/BookmarkBar.tsx'
```

### 覆盖率目标
- 语句覆盖率：≥85%
- 分支覆盖率：≥80%
- 函数覆盖率：≥90%
- 行覆盖率：≥85%

---

## E2E 测试（Playwright）

### 安装 Playwright（首次运行）
```bash
npm install -D @playwright/test
npx playwright install
```

### 运行所有 E2E 测试
```bash
npx playwright test
```

### 运行 BookmarkBar E2E 测试
```bash
npx playwright test bookmark-bar-collapse.spec.ts
```

### 运行测试并显示浏览器
```bash
npx playwright test --headed
```

### 调试模式
```bash
npx playwright test --debug
```

### 生成测试报告
```bash
npx playwright test --reporter=html
npx playwright show-report
```

---

## CI/CD 配置

### GitHub Actions 示例
```yaml
name: Test BookmarkBar

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: 18

      # 单元测试
      - name: Install dependencies
        run: npm ci

      - name: Run unit tests
        run: npm test -- --coverage

      - name: Upload coverage
        uses: codecov/codecov-action@v3

      # E2E 测试
      - name: Install Playwright
        run: npx playwright install --with-deps

      - name: Run E2E tests
        run: npx playwright test

      - name: Upload test results
        if: always()
        uses: actions/upload-artifact@v3
        with:
          name: playwright-report
          path: playwright-report/
```

---

## 测试场景覆盖

### ✅ 已覆盖的场景

1. **折叠状态布局**
   - `position: absolute` 确保脱离文档流
   - `height: 0` 确保不占据垂直空间
   - `pointer-events: none` 确保不阻挡其他元素

2. **展开状态布局**
   - 正常占据 36px 高度
   - flex 布局正常工作

3. **折叠/展开切换**
   - 点击按钮触发状态切换
   - 平滑过渡动画

4. **响应式布局**
   - 窗口宽度 < 1200px 时自动折叠

5. **DOM 优化**
   - 折叠状态下不渲染书签列表

6. **边界情况**
   - 没有书签时的空状态
   - 加载状态
   - 超过 10 个书签时显示"更多"按钮

---

## 预期测试结果

### 单元测试
```
 PASS  src/renderer/src/components/__tests__/BookmarkBar.test.tsx
  BookmarkBar - 折叠状态布局测试
    折叠状态（isCollapsed=true）
      ✓ 应该应用 collapsed 类名 (12 ms)
      ✓ 应该不占据布局空间（position: absolute） (8 ms)
      ✓ 应该只显示一个折叠按钮和书签数量 (10 ms)
      ✓ 点击折叠按钮应该触发 onToggleCollapse (5 ms)
    展开状态（isCollapsed=false）
      ✓ 应该不应用 collapsed 类名 (6 ms)
      ✓ 应该正常占据布局空间（height: 36px） (7 ms)
      ✓ 应该显示书签列表 (11 ms)
      ✓ 超过 10 个书签时应该显示"更多"按钮 (9 ms)
    边界情况
      ✓ 没有书签时应该显示空状态 (5 ms)
      ✓ 加载状态应该显示加载提示 (4 ms)
      ✓ 折叠状态下不应该渲染书签列表（DOM 优化） (6 ms)
    高亮当前文件
      ✓ 应该高亮当前打开的文件 (8 ms)

Test Suites: 1 passed, 1 total
Tests:       12 passed, 12 total
Coverage:    语句 87%, 分支 82%, 函数 92%, 行 88%
```

### E2E 测试
```
Running 8 tests using 1 worker

  ✓ [chromium] › bookmark-bar-collapse.spec.ts:12:3 › 折叠状态下 BookmarkBar 不应占据垂直空间 (1.2s)
  ✓ [chromium] › bookmark-bar-collapse.spec.ts:25:3 › 展开状态下 BookmarkBar 应占据 36px 高度 (1.5s)
  ✓ [chromium] › bookmark-bar-collapse.spec.ts:43:3 › 折叠状态下仍可以看到并点击悬浮按钮 (0.9s)
  ✓ [chromium] › bookmark-bar-collapse.spec.ts:61:3 › 折叠/展开切换应该平滑过渡 (1.8s)
  ✓ [chromium] › bookmark-bar-collapse.spec.ts:84:3 › 折叠状态下书签列表不应该渲染在 DOM 中 (0.7s)
  ✓ [chromium] › bookmark-bar-collapse.spec.ts:95:3 › 展开状态下应该显示书签列表 (1.1s)
  ✓ [chromium] › bookmark-bar-collapse.spec.ts:111:3 › 窗口宽度小于 1200px 时应该自动折叠 (1.3s)
  ✓ [chromium] › bookmark-bar-collapse.spec.ts:125:3 › CSS 计算样式验证 (1.0s)

  8 passed (9.5s)
```
