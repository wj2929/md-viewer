#!/usr/bin/env bash
# MD Viewer v2.3 local smoke gates.

set -euo pipefail

MODE="${1:-quick}"

ensure_project_root() {
  if [ ! -f "package.json" ]; then
    echo "错误：请在项目根目录运行此脚本"
    exit 1
  fi

  local package_name
  package_name="$(node -p "require('./package.json').name")"
  if [ "$package_name" != "md-viewer" ]; then
    echo "错误：当前 package.json 不是 md-viewer，实际为：${package_name}"
    exit 1
  fi
}

run_step() {
  local name="$1"
  shift
  echo ""
  echo "==> ${name}"
  "$@"
}

print_artifacts_hint() {
  echo ""
  echo "失败产物目录（如有）："
  echo "  test-results/"
  echo "  playwright-report/"
  echo "  e2e-results.json"
}

ensure_project_root
trap print_artifacts_hint EXIT

case "$MODE" in
  quick)
    echo "运行 v2.3 快速门禁"
    echo "可用模式：quick | full"
    run_step "类型检查" npm run typecheck
    run_step "ESLint" npm run lint
    run_step "核心单元测试" npm test -- --run \
      src/renderer/test/components/FileTree.test.tsx \
      src/renderer/test/components/VirtualizedMarkdown.test.tsx \
      src/renderer/test/utils/exportHtml.responsive.test.ts
    run_step "构建 E2E 产物" npm run build
    run_step "核心 E2E" npm run test:e2e -- \
      e2e/02-file-tree.spec.ts \
      e2e/markdown-edit-mode.spec.ts
    ;;
  full)
    echo "运行 v2.3 完整发版门禁"
    run_step "类型检查" npm run typecheck
    run_step "ESLint" npm run lint
    run_step "全量单元测试" npm test -- --run
    run_step "构建" npm run build
    run_step "核心 E2E" npm run test:e2e -- \
      e2e/02-file-tree.spec.ts \
      e2e/03-markdown-rendering.spec.ts \
      e2e/05-export-features.spec.ts \
      e2e/markdown-edit-mode.spec.ts
    ;;
  *)
    echo "未知模式：$MODE"
    echo "用法：scripts/release-smoke.sh [quick|full]"
    exit 2
    ;;
esac

trap - EXIT
echo ""
echo "v2.3 ${MODE} 门禁通过"
print_artifacts_hint
