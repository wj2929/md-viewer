#!/usr/bin/env bash
# MD Viewer v2.5 local smoke gates.

set -euo pipefail

MODE="${1:-quick}"
DOCX_SERVICE_PID=""
DOCX_SERVICE_LOG="${MD_VIEWER_DOCX_SERVICE_LOG:-/tmp/md-viewer-docx-service-release-smoke.log}"
DOCX_SERVICE_URL="${MD_VIEWER_DOCX_SERVICE_URL:-http://127.0.0.1:3179}"

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

run_cli_e2e() {
  env \
    PLAYWRIGHT_HTML_REPORT=/tmp/md-viewer-cli-headless-report \
    npm run test:e2e -- \
      e2e/cli-headless-render.spec.ts \
      --output=/tmp/md-viewer-cli-headless-pw-results
}

run_core_e2e() {
  env \
    MD_VIEWER_DOCX_SERVICE_URL="${DOCX_SERVICE_URL}" \
    PLAYWRIGHT_HTML_REPORT=/tmp/md-viewer-core-e2e-report \
    npm run test:e2e -- \
      "$@" \
      --output=/tmp/md-viewer-core-e2e-pw-results
}

is_docx_service_ready() {
  curl -fsS "${DOCX_SERVICE_URL%/}/healthz" >/dev/null 2>&1
}

wait_for_docx_service() {
  local deadline=$((SECONDS + 30))
  while [ "$SECONDS" -lt "$deadline" ]; do
    if is_docx_service_ready; then
      return 0
    fi
    sleep 1
  done
  return 1
}

ensure_docx_service_for_full() {
  export MD_VIEWER_DOCX_SERVICE_URL="${DOCX_SERVICE_URL}"
  if is_docx_service_ready; then
    echo "复用已运行的 DOCX 服务：${DOCX_SERVICE_URL}"
    return 0
  fi

  if [ "${DOCX_SERVICE_URL}" != "http://127.0.0.1:3179" ] && [ "${DOCX_SERVICE_URL}" != "http://localhost:3179" ]; then
    echo "错误：${DOCX_SERVICE_URL} 未连接，且非默认本地地址。请先启动 DOCX 服务或设置可用的 MD_VIEWER_DOCX_SERVICE_URL。"
    exit 1
  fi

  local service_dir="../md-viewer-docx-service"
  local python_bin="${service_dir}/.venv/bin/python"
  if [ ! -d "${service_dir}" ] || [ ! -x "${python_bin}" ]; then
    echo "错误：完整门禁需要 DOCX 服务。未找到 ${python_bin}，请先准备 ../md-viewer-docx-service 的 Python 环境。"
    exit 1
  fi

  echo "启动本地 DOCX 服务：${DOCX_SERVICE_URL}"
  (
    cd "${service_dir}"
    "${python_bin}" -m uvicorn app.main:app --host 127.0.0.1 --port 3179
  ) >"${DOCX_SERVICE_LOG}" 2>&1 &
  DOCX_SERVICE_PID="$!"

  if ! wait_for_docx_service; then
    echo "错误：DOCX 服务启动超时，日志：${DOCX_SERVICE_LOG}"
    tail -80 "${DOCX_SERVICE_LOG}" || true
    exit 1
  fi
}

cleanup_docx_service() {
  if [ -n "${DOCX_SERVICE_PID}" ] && kill -0 "${DOCX_SERVICE_PID}" >/dev/null 2>&1; then
    kill "${DOCX_SERVICE_PID}" >/dev/null 2>&1 || true
    wait "${DOCX_SERVICE_PID}" >/dev/null 2>&1 || true
  fi
}

print_artifacts_hint() {
  echo ""
  echo "失败产物目录（如有）："
  echo "  test-results/"
  echo "  playwright-report/"
  echo "  /tmp/md-viewer-cli-headless-pw-results"
  echo "  /tmp/md-viewer-cli-headless-report"
  echo "  /tmp/md-viewer-core-e2e-pw-results"
  echo "  /tmp/md-viewer-core-e2e-report"
  echo "  e2e-results.json"
  if [ -n "${DOCX_SERVICE_LOG}" ]; then
    echo "  ${DOCX_SERVICE_LOG}"
  fi
}

ensure_project_root
trap 'cleanup_docx_service; print_artifacts_hint' EXIT

case "$MODE" in
  quick)
    echo "运行 v2.5 快速门禁"
    echo "可用模式：quick | full"
    run_step "类型检查" npm run typecheck
    run_step "ESLint" npm run lint
    run_step "CLI 单元测试" npm test -- --run src/main/__tests__/cli*.test.ts
    run_step "核心单元测试" npm test -- --run \
      src/renderer/test/components/FileTree.test.tsx \
      src/renderer/test/components/VirtualizedMarkdown.test.tsx \
      src/renderer/test/components/SearchBar.test.tsx \
      src/renderer/test/components/ExportTaskView.test.tsx \
      src/renderer/test/components/ShortcutsHelpDialog.test.tsx \
      src/renderer/test/utils/v24WorkflowContracts.test.ts \
      src/renderer/test/utils/exportHtml.responsive.test.ts
    run_step "构建 E2E 产物" npm run build
    run_step "CLI Headless E2E" run_cli_e2e
    run_step "核心 E2E" run_core_e2e \
      e2e/02-file-tree.spec.ts \
      e2e/markdown-edit-mode.spec.ts \
      e2e/markdown-links.spec.ts \
      e2e/read-position.spec.ts
    run_step "图表预览 Smoke" run_core_e2e \
      e2e/03-markdown-rendering.spec.ts \
      -g "Mermaid 图表|DrawIO 应渲染基础图"
    ;;
  full)
    echo "运行 v2.5 完整发版门禁"
    run_step "类型检查" npm run typecheck
    run_step "ESLint" npm run lint
    run_step "全量单元测试" npm test -- --run
    run_step "构建" npm run build
    run_step "准备 DOCX 服务" ensure_docx_service_for_full
    run_step "CLI Headless E2E" run_cli_e2e
    run_step "核心 E2E" run_core_e2e \
      e2e/02-file-tree.spec.ts \
      e2e/03-markdown-rendering.spec.ts \
      e2e/05-export-features.spec.ts \
      e2e/markdown-edit-mode.spec.ts \
      e2e/markdown-links.spec.ts \
      e2e/read-position.spec.ts
    ;;
  *)
    echo "未知模式：$MODE"
    echo "用法：scripts/release-smoke.sh [quick|full]"
    exit 2
    ;;
esac

cleanup_docx_service
trap - EXIT
echo ""
echo "v2.5 ${MODE} 门禁通过"
print_artifacts_hint
