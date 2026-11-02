import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

const scriptPath = resolve('scripts/release-smoke.sh')
const script = readFileSync(scriptPath, 'utf8')
const start = script.indexOf('ensure_docx_service_for_full() {')
const ensure = script.slice(start, script.indexOf('\n}\n', start) + 3)
function run(ready: boolean, policy = '0', body = ensure) {
  return spawnSync('bash', ['-c', `DOCX_SERVICE_URL=http://127.0.0.1:3179\nDOCX_SERVICE_PID=\nis_docx_service_ready() { return ${ready ? '0' : '1'}; }\n${body}\n${policy === 'default' ? 'unset MD_VIEWER_DOCX_AUTOSTART' : `export MD_VIEWER_DOCX_AUTOSTART=${policy}`}\nensure_docx_service_for_full`], { encoding: 'utf8' })
}
describe('完整门禁的DOCX自动启动策略', () => {
  it('脚本bash语法有效', () => {
    expect(spawnSync('bash', ['-n', scriptPath]).status).toBe(0)
  })
  it('禁自动启动仍复用健康服务', () => {
    const result = run(true)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('复用已运行')
    expect(result.stdout).not.toContain('启动本地')
  })
  it('禁自动启动且服务不可用即失败，不能进入venv检查/启动分支', () => {
    const result = run(false)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('已禁止自动启动')
    expect(result.stdout).not.toContain('启动本地')
    expect(result.stdout).not.toContain('未找到')
  })
  it.each(['default', '1'])('旧默认策略仍可进入启动准备分支：%s（用探针截断，不启动服务）', policy => {
    const probe = ensure.replace('  local service_dir=', '  printf DEFAULT_BRANCH_REACHED\n  return 0\n  local service_dir=')
    const result = run(false, policy, probe)
    expect(result.status).toBe(0)
    expect(result.stdout).toBe('DEFAULT_BRANCH_REACHED')
  })
})
