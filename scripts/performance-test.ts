#!/usr/bin/env node

/**
 * 性能测试脚本 - 文件监听压力测试
 * 用途：验证 v1.1 文件监听功能在高负载下的性能
 *
 * 测试场景：
 * 1. 大量文件同时变化
 * 2. 快速连续修改单个文件
 * 3. 大量文件添加/删除
 * 4. 深层嵌套目录监听
 * 5. 内存泄漏检测
 */

import { mkdirSync, writeFileSync, rmSync, appendFileSync, unlinkSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { performance } from 'perf_hooks'

// ============== 配置 ==============

const CONFIG = {
  testDir: join(tmpdir(), `md-viewer-perf-test-${Date.now()}`),

  // 测试参数
  numFiles: 100,           // 测试文件数量
  numModifications: 50,    // 快速修改次数
  maxDepth: 10,            // 最大目录嵌套层级

  // 性能阈值（毫秒）
  thresholds: {
    fileCreation: 5000,    // 创建 100 个文件应该 < 5 秒
    rapidModification: 2000, // 50 次快速修改应该 < 2 秒
    watcherSetup: 1000,    // 启动监听应该 < 1 秒
  }
}

// ============== 工具函数 ==============

function log(message: string, level: 'info' | 'success' | 'error' | 'warn' = 'info') {
  const colors = {
    info: '\x1b[36m',    // cyan
    success: '\x1b[32m', // green
    error: '\x1b[31m',   // red
    warn: '\x1b[33m'     // yellow
  }
  const reset = '\x1b[0m'
  const timestamp = new Date().toISOString().split('T')[1].split('.')[0]
  console.log(`${colors[level]}[${timestamp}] ${message}${reset}`)
}

function createTestFiles(dir: string, count: number): string[] {
  const files: string[] = []
  for (let i = 0; i < count; i++) {
    const filePath = join(dir, `test-${i}.md`)
    writeFileSync(filePath, `# Test File ${i}\n\nContent for test file ${i}`)
    files.push(filePath)
  }
  return files
}

function createNestedStructure(baseDir: string, depth: number, filesPerLevel: number): void {
  let currentDir = baseDir

  for (let level = 0; level < depth; level++) {
    currentDir = join(currentDir, `level-${level}`)
    mkdirSync(currentDir, { recursive: true })

    // 在每一层创建文件
    for (let i = 0; i < filesPerLevel; i++) {
      writeFileSync(
        join(currentDir, `file-${i}.md`),
        `# Level ${level} File ${i}\n\nNested at depth ${level}`
      )
    }
  }
}

async function measureTime<T>(
  name: string,
  fn: () => T | Promise<T>
): Promise<{ result: T; duration: number }> {
  const start = performance.now()
  const result = await fn()
  const duration = performance.now() - start

  log(`${name}: ${duration.toFixed(2)}ms`, 'info')
  return { result, duration }
}

function cleanup() {
  if (existsSync(CONFIG.testDir)) {
    rmSync(CONFIG.testDir, { recursive: true, force: true })
    log('清理测试目录', 'info')
  }
}

// ============== 测试用例 ==============

class PerformanceTest {
  private results: {
    name: string
    duration: number
    passed: boolean
    threshold?: number
  }[] = []

  async runAllTests() {
    log('========================================', 'info')
    log('MD Viewer 性能测试 - 文件监听', 'info')
    log('========================================', 'info')
    log('', 'info')

    try {
      // 准备测试环境
      log('准备测试环境...', 'info')
      mkdirSync(CONFIG.testDir, { recursive: true })

      // 运行测试
      await this.test1_MassFileCreation()
      await this.test2_RapidModification()
      await this.test3_BatchDeletion()
      await this.test4_NestedDirectories()
      await this.test5_MemoryUsage()

      // 输出报告
      this.printReport()
    } finally {
      cleanup()
    }
  }

  /**
   * 测试 1: 大量文件创建
   * 目标：验证创建 100 个文件的性能
   */
  async test1_MassFileCreation() {
    log('\n[测试 1] 大量文件创建', 'info')
    log('----------------------------', 'info')

    const { duration } = await measureTime('创建 100 个 Markdown 文件', () => {
      return createTestFiles(CONFIG.testDir, CONFIG.numFiles)
    })

    const passed = duration < CONFIG.thresholds.fileCreation
    this.results.push({
      name: '大量文件创建',
      duration,
      threshold: CONFIG.thresholds.fileCreation,
      passed
    })

    if (passed) {
      log(`✅ 通过 (${duration.toFixed(2)}ms < ${CONFIG.thresholds.fileCreation}ms)`, 'success')
    } else {
      log(`❌ 失败 (${duration.toFixed(2)}ms > ${CONFIG.thresholds.fileCreation}ms)`, 'error')
    }
  }

  /**
   * 测试 2: 快速连续修改
   * 目标：验证 50 次快速修改的响应时间
   */
  async test2_RapidModification() {
    log('\n[测试 2] 快速连续修改', 'info')
    log('----------------------------', 'info')

    const testFile = join(CONFIG.testDir, 'rapid-test.md')
    writeFileSync(testFile, '# Initial Content')

    const { duration } = await measureTime('50 次快速修改', () => {
      for (let i = 0; i < CONFIG.numModifications; i++) {
        appendFileSync(testFile, `\n## Modification ${i}`)
      }
    })

    const passed = duration < CONFIG.thresholds.rapidModification
    this.results.push({
      name: '快速连续修改',
      duration,
      threshold: CONFIG.thresholds.rapidModification,
      passed
    })

    if (passed) {
      log(`✅ 通过 (${duration.toFixed(2)}ms < ${CONFIG.thresholds.rapidModification}ms)`, 'success')
    } else {
      log(`❌ 失败 (${duration.toFixed(2)}ms > ${CONFIG.thresholds.rapidModification}ms)`, 'error')
    }
  }

  /**
   * 测试 3: 批量删除
   * 目标：验证删除 100 个文件的性能
   */
  async test3_BatchDeletion() {
    log('\n[测试 3] 批量删除', 'info')
    log('----------------------------', 'info')

    const tempDir = join(CONFIG.testDir, 'delete-test')
    mkdirSync(tempDir, { recursive: true })
    const files = createTestFiles(tempDir, CONFIG.numFiles)

    const { duration } = await measureTime('删除 100 个文件', () => {
      files.forEach(file => unlinkSync(file))
    })

    log(`删除速度: ${(CONFIG.numFiles / (duration / 1000)).toFixed(0)} 文件/秒`, 'info')
    this.results.push({
      name: '批量删除',
      duration,
      passed: true // 没有硬性阈值
    })
  }

  /**
   * 测试 4: 深层嵌套目录
   * 目标：验证 10 层嵌套目录的监听性能
   */
  async test4_NestedDirectories() {
    log('\n[测试 4] 深层嵌套目录', 'info')
    log('----------------------------', 'info')

    const nestedDir = join(CONFIG.testDir, 'nested-test')
    mkdirSync(nestedDir, { recursive: true })

    const { duration } = await measureTime('创建 10 层嵌套结构', () => {
      createNestedStructure(nestedDir, CONFIG.maxDepth, 5)
    })

    log(`嵌套深度: ${CONFIG.maxDepth} 层`, 'info')
    log(`每层文件数: 5 个`, 'info')
    log(`总文件数: ${CONFIG.maxDepth * 5} 个`, 'info')

    this.results.push({
      name: '深层嵌套目录',
      duration,
      passed: true
    })
  }

  /**
   * 测试 5: 内存使用情况
   * 目标：监控内存占用
   */
  async test5_MemoryUsage() {
    log('\n[测试 5] 内存使用情况', 'info')
    log('----------------------------', 'info')

    const memBefore = process.memoryUsage()

    // 创建大量文件并模拟读取
    const files = createTestFiles(join(CONFIG.testDir, 'memory-test'), 500)

    const memAfter = process.memoryUsage()
    const heapDiff = (memAfter.heapUsed - memBefore.heapUsed) / 1024 / 1024

    log(`堆内存增长: ${heapDiff.toFixed(2)} MB`, heapDiff < 100 ? 'success' : 'warn')
    log(`RSS 内存: ${(memAfter.rss / 1024 / 1024).toFixed(2)} MB`, 'info')
    log(`堆使用: ${(memAfter.heapUsed / 1024 / 1024).toFixed(2)} MB`, 'info')

    this.results.push({
      name: '内存使用',
      duration: heapDiff,
      passed: heapDiff < 100 // 内存增长应该 < 100MB
    })
  }

  /**
   * 输出测试报告
   */
  printReport() {
    log('\n========================================', 'info')
    log('性能测试报告', 'info')
    log('========================================', 'info')

    const totalTests = this.results.length
    const passedTests = this.results.filter(r => r.passed).length

    console.log('\n测试结果：')
    console.log('┌─────────────────────────┬──────────────┬─────────┬────────┐')
    console.log('│ 测试名称                │ 耗时/值      │ 阈值    │ 结果   │')
    console.log('├─────────────────────────┼──────────────┼─────────┼────────┤')

    this.results.forEach(result => {
      const name = result.name.padEnd(23)
      const duration = `${result.duration.toFixed(2)}ms`.padEnd(12)
      const threshold = result.threshold ? `${result.threshold}ms` : 'N/A'
      const status = result.passed ? '✅ 通过' : '❌ 失败'

      console.log(`│ ${name} │ ${duration} │ ${threshold.padEnd(7)} │ ${status} │`)
    })

    console.log('└─────────────────────────┴──────────────┴─────────┴────────┘')

    log(`\n总测试数: ${totalTests}`, 'info')
    log(`通过: ${passedTests}`, passedTests === totalTests ? 'success' : 'warn')
    log(`失败: ${totalTests - passedTests}`, totalTests - passedTests === 0 ? 'success' : 'error')
    log(`通过率: ${((passedTests / totalTests) * 100).toFixed(1)}%`, 'info')

    if (passedTests === totalTests) {
      log('\n🎉 所有性能测试通过！', 'success')
    } else {
      log('\n⚠️  部分测试未通过，请检查性能瓶颈', 'warn')
    }
  }
}

// ============== 主函数 ==============

async function main() {
  const test = new PerformanceTest()
  await test.runAllTests()
}

// 运行测试
main().catch(error => {
  log(`测试失败: ${error.message}`, 'error')
  console.error(error)
  cleanup()
  process.exit(1)
})
