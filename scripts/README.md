# Scripts 目录说明

本目录包含项目开发和发布流程中使用的自动化脚本。

---

## 📁 脚本清单

### `release-check.sh` - 发布验证脚本 ✅

**用途**：在发布新版本前，自动验证所有发布条件是否满足。

**功能**：
- ✅ 检查 package.json 版本号与 Git tag 是否匹配
- ✅ 检查工作区是否干净（无未提交修改）
- ✅ 检查本地与远程是否同步
- ✅ 检查 GitHub Release 是否存在
- ✅ 检查 GitHub Release 是否为 Draft 状态
- ✅ 检查 Git tag 是否已推送到远程

**使用方法**：

```bash
# 在项目根目录运行
./scripts/release-check.sh
```

**成功输出示例**：

```
=========================================
🔍 MD Viewer Release Check
=========================================

📦 [1/6] 检查 package.json 版本号...
   package.json 版本: 1.3.7
✅ 版本号匹配

📂 [2/6] 检查 Git 工作区...
✅ 工作区干净

🔄 [3/6] 检查本地与远程同步...
✅ 本地与远程同步

🚀 [4/6] 检查 GitHub Release...
✅ Release 已发布

🔖 [5/6] 检查 Git tag 是否已推送...
✅ Git tag 已推送

=========================================
🎉 所有检查通过！v1.3.7 可以标记为"已发布"
=========================================
```

**失败输出示例**：

```
📦 [1/6] 检查 package.json 版本号...
   package.json 版本: 1.3.8
❌ 版本号不匹配！
   预期 Git tag: v1.3.8
   实际 Git tag: v1.3.7

   修复方法：
   git tag -a v1.3.8 -m "v1.3.8"
   git push origin v1.3.8
```

**依赖**：
- Git
- GitHub CLI (`gh`) - 可选，用于检查 GitHub Release 状态

**注意事项**：
- 必须在项目根目录运行（有 package.json 的目录）
- 如果未安装 `gh` CLI，会跳过 GitHub Release 检查
- 脚本遇到错误会立即退出，并提供修复命令

---

## 🚀 发布流程

**完整发布流程**（见 [README.md](../README.md#发布流程)）：

1. 更新 package.json 版本号
2. 提交并打 Git tag
3. 推送到 GitHub
4. 创建并发布 GitHub Release
5. **运行 `./scripts/release-check.sh` 验证** ✅
6. 检查通过后，更新文档

**为什么需要这个脚本？**

在 v1.3.7 发布时，发现了以下问题：
- ❌ package.json 版本号未更新（停留在 1.3.5）
- ❌ GitHub Release 是 Draft 状态（未发布）
- ❌ 提交未推送到远程

这些问题导致用户无法看到最新版本。为了防止再次发生，创建了这个自动验证脚本。

---

## 📝 添加新脚本

如果需要添加新的自动化脚本，请遵循以下规范：

1. **命名规范**：使用小写字母和连字符（如 `release-check.sh`）
2. **Shebang**：脚本开头添加 `#!/bin/bash`
3. **错误处理**：使用 `set -e` 遇到错误立即退出
4. **注释**：在脚本开头添加用途说明
5. **可执行权限**：`chmod +x scripts/your-script.sh`
6. **文档**：在本 README 中添加脚本说明

**示例**：

```bash
#!/bin/bash
# 脚本用途说明
# 创建日期：YYYY-MM-DD

set -e  # 遇到错误立即退出

# 颜色输出
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo "开始执行..."

# 你的脚本逻辑
```

---

## 🔗 相关文档

- [README.md](../README.md) - 项目主文档
- [PROGRESS.md](../../PROGRESS.md) - 项目进度追踪（外部目录）
- [CONTEXT-RECOVERY.md](../../CONTEXT-RECOVERY.md) - 上下文恢复指南（外部目录）

---

**最后更新**：2026-01-09
