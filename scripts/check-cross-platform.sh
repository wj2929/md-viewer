#!/bin/bash
# 跨平台兼容性静态检测脚本
# 用于检测常见的 macOS 硬编码问题
# 用法: bash scripts/check-cross-platform.sh

set -euo pipefail

SRC_DIR="src"
ERRORS=0

echo "=== 跨平台兼容性检测 ==="
echo ""

# 1. 检查硬编码的 macOS 符号（排除已知安全文件）
echo "--- [1] 检查硬编码的 macOS 快捷键符号 (⌘⌥⌃⇧) ---"
RESULT=$(grep -rn '[⌘⌥⌃⇧]' "$SRC_DIR/renderer/src/components/" --include='*.tsx' \
  | grep -v 'ShortcutsHelpDialog' \
  | grep -v 'isMac' \
  | grep -v 'platform' \
  || true)
if [ -n "$RESULT" ]; then
  echo "$RESULT"
  ERRORS=$((ERRORS + $(echo "$RESULT" | wc -l)))
else
  echo "  ✅ 无问题"
fi
echo ""

# 2. 检查硬编码的 Finder 文案（排除已正确处理的文件）
echo "--- [2] 检查硬编码的 'Finder' 文案 ---"
RESULT=$(grep -rn 'Finder' "$SRC_DIR/" --include='*.ts' --include='*.tsx' \
  | grep -v 'contextMenuHandler.ts' \
  | grep -v '__tests__' \
  | grep -v 'node_modules' \
  | grep -v 'fileManagerName' \
  | grep -v 'platform.*darwin' \
  | grep -v '// .*Finder' \
  || true)
if [ -n "$RESULT" ]; then
  echo "$RESULT"
  ERRORS=$((ERRORS + $(echo "$RESULT" | wc -l)))
else
  echo "  ✅ 无问题"
fi
echo ""

# 3. 检查只使用 metaKey 的快捷键（未同时检查 ctrlKey）
echo "--- [3] 检查只使用 e.metaKey 的快捷键 ---"
RESULT=$(grep -rn 'e\.metaKey' "$SRC_DIR/renderer/" --include='*.tsx' \
  | grep -v 'ctrlKey' \
  | grep -v 'isMac' \
  | grep -v 'platform' \
  || true)
if [ -n "$RESULT" ]; then
  echo "$RESULT"
  ERRORS=$((ERRORS + $(echo "$RESULT" | wc -l)))
else
  echo "  ✅ 无问题"
fi
echo ""

# 4. 检查硬编码的路径分隔符
echo "--- [4] 检查硬编码的 split('/') ---"
RESULT=$(grep -rn "split('/')" "$SRC_DIR/renderer/" --include='*.tsx' \
  || true)
if [ -n "$RESULT" ]; then
  echo "$RESULT"
  ERRORS=$((ERRORS + $(echo "$RESULT" | wc -l)))
else
  echo "  ✅ 无问题"
fi
echo ""

# 5. 检查废弃的 navigator.platform
echo "--- [5] 检查废弃的 navigator.platform ---"
RESULT=$(grep -rn 'navigator\.platform' "$SRC_DIR/renderer/" --include='*.tsx' --include='*.ts' \
  || true)
if [ -n "$RESULT" ]; then
  echo "$RESULT"
  ERRORS=$((ERRORS + $(echo "$RESULT" | wc -l)))
else
  echo "  ✅ 无问题"
fi
echo ""

# 6. 检查 CSS 中硬编码的 80px（macOS 红绿灯偏移）
echo "--- [6] 检查 CSS 中硬编码的 80px ---"
RESULT=$(grep -rn '80px' "$SRC_DIR/renderer/" --include='*.css' \
  | grep -v 'data-platform' \
  | grep -v 'var(' \
  || true)
if [ -n "$RESULT" ]; then
  echo "$RESULT"
  ERRORS=$((ERRORS + $(echo "$RESULT" | wc -l)))
else
  echo "  ✅ 无问题"
fi
echo ""

echo "=== 检测完成 ==="
if [ "$ERRORS" -gt 0 ]; then
  echo "⚠️  发现 $ERRORS 个潜在的跨平台兼容性问题"
  exit 1
else
  echo "✅ 未发现跨平台兼容性问题"
  exit 0
fi
