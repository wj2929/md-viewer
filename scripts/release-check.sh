#!/bin/bash
# MD Viewer Release Check Script
# 用途：验证版本发布前的所有必要条件
# 创建日期：2026-01-09

set -e  # 遇到错误立即退出

# 颜色输出
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "========================================="
echo "🔍 MD Viewer Release Check"
echo "========================================="
echo ""

# 检查是否在项目根目录
if [ ! -f "package.json" ]; then
  echo -e "${RED}❌ 错误：请在项目根目录运行此脚本${NC}"
  exit 1
fi

# 1. 检查 package.json 版本号
echo "📦 [1/6] 检查 package.json 版本号..."
PACKAGE_VERSION=$(cat package.json | grep '"version"' | sed 's/.*"version": "\(.*\)".*/\1/')
echo "   package.json 版本: $PACKAGE_VERSION"

# 2. 检查 Git tag
echo ""
echo "🏷️  [2/6] 检查 Git tag..."
LATEST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "none")
echo "   最新 Git tag: $LATEST_TAG"

if [ "v$PACKAGE_VERSION" != "$LATEST_TAG" ]; then
  echo -e "${RED}   ❌ 版本号不匹配！${NC}"
  echo -e "${YELLOW}   预期 Git tag: v$PACKAGE_VERSION${NC}"
  echo -e "${YELLOW}   实际 Git tag: $LATEST_TAG${NC}"
  echo ""
  echo -e "${YELLOW}   修复方法：${NC}"
  echo "   git tag -a v$PACKAGE_VERSION -m \"v$PACKAGE_VERSION\""
  echo "   git push origin v$PACKAGE_VERSION"
  exit 1
fi
echo -e "${GREEN}   ✅ 版本号匹配${NC}"

# 3. 检查 Git 工作区状态
echo ""
echo "📂 [3/6] 检查 Git 工作区..."
if ! git diff-index --quiet HEAD --; then
  echo -e "${RED}   ❌ 工作区有未提交的修改${NC}"
  echo ""
  git status --short
  echo ""
  echo -e "${YELLOW}   修复方法：${NC}"
  echo "   git add ."
  echo "   git commit -m \"your message\""
  exit 1
fi
echo -e "${GREEN}   ✅ 工作区干净${NC}"

# 4. 检查本地与远程同步状态
echo ""
echo "🔄 [4/6] 检查本地与远程同步..."
git fetch origin main --quiet
LOCAL_COMMIT=$(git rev-parse HEAD)
REMOTE_COMMIT=$(git rev-parse origin/main)

if [ "$LOCAL_COMMIT" != "$REMOTE_COMMIT" ]; then
  # 检查是本地领先还是远程领先
  AHEAD=$(git rev-list --count origin/main..HEAD)
  BEHIND=$(git rev-list --count HEAD..origin/main)

  if [ "$AHEAD" -gt 0 ]; then
    echo -e "${RED}   ❌ 本地领先远程 $AHEAD 个提交${NC}"
    echo ""
    echo -e "${YELLOW}   修复方法：${NC}"
    echo "   git push origin main"
    exit 1
  fi

  if [ "$BEHIND" -gt 0 ]; then
    echo -e "${RED}   ❌ 远程领先本地 $BEHIND 个提交${NC}"
    echo ""
    echo -e "${YELLOW}   修复方法：${NC}"
    echo "   git pull origin main"
    exit 1
  fi
fi
echo -e "${GREEN}   ✅ 本地与远程同步${NC}"

# 5. 检查 GitHub Release（需要 gh cli）
echo ""
echo "🚀 [5/6] 检查 GitHub Release..."

if ! command -v gh &> /dev/null; then
  echo -e "${YELLOW}   ⚠️  未安装 gh cli，跳过 Release 检查${NC}"
else
  # 检查 Release 是否存在
  if ! gh release view "v$PACKAGE_VERSION" &> /dev/null; then
    echo -e "${RED}   ❌ GitHub Release v$PACKAGE_VERSION 不存在${NC}"
    echo ""
    echo -e "${YELLOW}   修复方法：${NC}"
    echo "   gh release create v$PACKAGE_VERSION --title \"v$PACKAGE_VERSION\" --notes \"Release notes\""
    exit 1
  fi

  # 检查 Release 是否为 Draft
  IS_DRAFT=$(gh release view "v$PACKAGE_VERSION" --json isDraft -q .isDraft)
  if [ "$IS_DRAFT" = "true" ]; then
    echo -e "${RED}   ❌ Release 是草稿状态（未发布）${NC}"
    echo ""
    echo -e "${YELLOW}   修复方法：${NC}"
    echo "   gh release edit v$PACKAGE_VERSION --draft=false --latest"
    exit 1
  fi

  echo -e "${GREEN}   ✅ Release 已发布${NC}"
fi

# 6. 检查 Git tag 是否已推送
echo ""
echo "🔖 [6/6] 检查 Git tag 是否已推送..."
if ! git ls-remote --tags origin | grep -q "refs/tags/v$PACKAGE_VERSION"; then
  echo -e "${RED}   ❌ Git tag 未推送到远程${NC}"
  echo ""
  echo -e "${YELLOW}   修复方法：${NC}"
  echo "   git push origin v$PACKAGE_VERSION"
  exit 1
fi
echo -e "${GREEN}   ✅ Git tag 已推送${NC}"

# 所有检查通过
echo ""
echo "========================================="
echo -e "${GREEN}🎉 所有检查通过！v$PACKAGE_VERSION 可以标记为"已发布"${NC}"
echo "========================================="
echo ""
echo "📊 版本信息："
echo "   版本号: v$PACKAGE_VERSION"
echo "   Git SHA: $LOCAL_COMMIT"
echo "   Release: https://github.com/wj2929/md-viewer/releases/tag/v$PACKAGE_VERSION"
echo ""

exit 0
