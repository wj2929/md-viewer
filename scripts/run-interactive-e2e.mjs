import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'

const require = createRequire(import.meta.url)
const projectRoot = path.resolve(import.meta.dirname, '..')
const playwrightCli = require.resolve('@playwright/test/cli')
const interactiveTests = [
  'e2e/settings-tabbar-visual.spec.ts',
  'e2e/move-to-visual.spec.ts',
  'e2e/workspace-transfer.spec.ts',
  '--grep',
  [
    '设置多 Tab',
    '历史文件夹菜单不应被标签栏遮挡',
    '快捷键帮助弹窗包含使用手册入口',
    '使用手册中的本地图片应正常加载',
    '展示最近目录搜索和目标确认',
    '合并面板独立于工作区菜单',
    '按真实窗口分组并区分同名会话',
    '按真实来源窗口展示多会话拓扑并过滤纯空窗口',
  ].join('|'),
]
const child = spawn(
  process.execPath,
  [playwrightCli, 'test', ...interactiveTests, ...process.argv.slice(2)],
  {
    cwd: projectRoot,
    env: {
      ...process.env,
      MD_VIEWER_E2E_VISIBLE: '1',
    },
    stdio: 'inherit',
  },
)

child.on('error', error => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`interactive E2E 被信号 ${signal} 终止`)
    process.exitCode = 1
    return
  }
  process.exitCode = code ?? 1
})
