import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  truncate,
  utimes,
  writeFile,
} from 'fs/promises'
import { homedir, tmpdir } from 'os'
import path from 'path'
import {
  DIAGNOSTIC_EVENT_SCHEMA_VERSION,
  sanitizeRendererDiagnosticEvent,
  sanitizeDiagnosticMetadata,
} from '../../shared/diagnostics'
import { DiagnosticEventLogService } from '../diagnostics/DiagnosticEventLogService'

const services: DiagnosticEventLogService[] = []
const tempDirectories: string[] = []

async function createTempDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), prefix))
  tempDirectories.push(directory)
  return directory
}

async function createService(settings: unknown = undefined): Promise<{
  service: DiagnosticEventLogService
  defaultDirectory: string
  userDataDirectory: string
}> {
  const root = await createTempDirectory('mdv-event-log-')
  const defaultDirectory = path.join(root, 'logs')
  const userDataDirectory = path.join(root, 'user-data')
  const service = new DiagnosticEventLogService()
  services.push(service)
  service.initialize({ defaultDirectory, userDataDirectory, settings })
  await waitForInitialization(service)
  return { service, defaultDirectory, userDataDirectory }
}

async function waitForInitialization(service: DiagnosticEventLogService): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const status = await service.getStatus()
    if (status.state !== 'initializing') return
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error('diagnostic event service did not initialize')
}

async function readAllLogBytes(directory: string): Promise<Buffer> {
  const names = (await readdir(directory)).filter(name => name.endsWith('.jsonl')).sort()
  const chunks = await Promise.all(names.map(name => readFile(path.join(directory, name))))
  return Buffer.concat(chunks)
}

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(services.splice(0).map(service => service.setEnabled(false).catch(() => {})))
  await Promise.all(tempDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

describe('diagnostic event schema', () => {
  it('只接受白名单事件、ID、时间和 metadata', () => {
    const now = Date.now()
    const valid = sanitizeRendererDiagnosticEvent({
      schemaVersion: DIAGNOSTIC_EVENT_SCHEMA_VERSION,
      event: 'file.open.start',
      observedUnixMs: now,
      monotonicMs: 10,
      processInstanceId: 'renderer_12345678',
      processSeq: 1,
      operationId: 'operation_12345678',
      metadata: { source: 'user', documentVisible: true },
    }, now)

    expect(valid?.event).toBe('file.open.start')
    expect(sanitizeRendererDiagnosticEvent({
      ...valid,
      event: 'arbitrary.console',
    }, now)).toBeNull()
    expect(sanitizeRendererDiagnosticEvent({
      ...valid,
      metadata: { markdownBody: 'secret' },
    }, now)).toBeNull()
    expect(sanitizeRendererDiagnosticEvent({
      ...valid,
      observedUnixMs: now - 10 * 60 * 1000,
    }, now)).toBeNull()
  })
})

describe('DiagnosticEventLogService', () => {
  it('预览状态必须为固定值，关联操作只作日志用途', async () => {
    const { service, defaultDirectory } = await createService()
    const operationId = 'file_waiting_12345678'
    const now = Date.now()
    service.recordRendererEvent(7, { schemaVersion: DIAGNOSTIC_EVENT_SCHEMA_VERSION, event: 'file.open.start',
      observedUnixMs: now, monotonicMs: 1, processInstanceId: 'renderer_self_1234', processSeq: 1, operationId })
    vi.spyOn(Date, 'now').mockReturnValue(now + 11 * 60 * 1000)
    const input = { schemaVersion: DIAGNOSTIC_EVENT_SCHEMA_VERSION, event: 'file.preview.state',
      observedUnixMs: Date.now(), monotonicMs: 2, processInstanceId: 'renderer_self_1234', processSeq: 2,
      metadata: { previewState: 'source-ready', previewInstanceId: 'preview_self_1234', relatedOperationId: operationId } }
    expect(sanitizeRendererDiagnosticEvent(input)).toEqual(input)
    for (const key of ['previewState', 'relatedOperationId']) {
      expect(sanitizeDiagnosticMetadata({ [key]: '/Users/private/document.md' })).toBeNull()
      expect(sanitizeDiagnosticMetadata({ [key]: true })).toBeNull()
    }
    expect(sanitizeRendererDiagnosticEvent({ ...input, operationId })).toBeNull()
    expect(sanitizeRendererDiagnosticEvent({ ...input, metadata: { previewState: 'source-ready' } })).toBeNull()
    service.recordRendererEvent(7, input)
    expect(service.isRegisteredOperation(7, operationId, 'file')).toBe(false)
    await service.flush()
    const text = (await readAllLogBytes(defaultDirectory)).toString('utf8')
    expect(text).toContain('file.preview.state')
    expect(text).toContain('source-ready')
    expect((await service.getStatus()).invalidEvents).toBe(0)
  })

  it('持久化面板触发链，只接受固定来源、树位置和随机工作区引用', async () => {
    const { service, defaultDirectory } = await createService()
    const metadata = { paneSource: 'panel-click', paneAction: 'split', workspaceEpoch: 4,
      workspaceTraceId: 'workspace_12345678-1234-1234-1234-123456789abc', hydrationGeneration: 2,
      paneSequence: 8, lastTabChangeSequence: 7, beforeLeafPosition: 'root.second.first',
      afterLeafPosition: 'root.first', beforeTabSlot: 1, afterTabSlot: 0, inputTrusted: false }
    expect(sanitizeDiagnosticMetadata(metadata)).toEqual(metadata)
    for (const key of ['paneSource', 'paneAction', 'workspaceTraceId', 'beforeLeafPosition', 'afterLeafPosition']) {
      expect(sanitizeDiagnosticMetadata({ [key]: '/Users/private/Secret.md' })).toBeNull()
      expect(sanitizeDiagnosticMetadata({ [key]: true })).toBeNull()
    }
    expect(sanitizeDiagnosticMetadata({ beforeLeafPosition: 'root.first.first.first.first' })).toBeNull()
    const input = { schemaVersion: DIAGNOSTIC_EVENT_SCHEMA_VERSION, event: 'workspace.pane.change',
      observedUnixMs: Date.now(), monotonicMs: 5, processInstanceId: 'renderer_12345678', processSeq: 1, metadata }
    expect(sanitizeRendererDiagnosticEvent(input)?.metadata).toEqual(metadata)
    service.recordRendererEvent(7, input)
    await service.flush()
    const text = (await readAllLogBytes(defaultDirectory)).toString('utf8')
    expect(text).toContain('workspace.pane.change')
    expect(text).toContain('root.second.first')
    expect(text).not.toContain('/Users/private')
    expect((await service.getStatus()).invalidEvents).toBe(0)
  })

  it('persists safe watcher startup observations and rejects private stage/error text', async () => {
    const { service, defaultDirectory } = await createService()
    const metadata = { watchStage: 'watch-created', watchKind: 'root', state: 'starting',
      startupElapsedMs: 5000, acceptedMs: 10, childElapsedMs: 20, stageAgeMs: 4980,
      lastPongAgeMs: 0, watchPathChecks: 3, watchDirectoryChecks: 1,
      watchErrorCode: 'EACCES', processExitConfirmed: true, failedWatchCount: 1, watchSubscriptionCount: 1 }
    expect(sanitizeDiagnosticMetadata(metadata)).toEqual(metadata)
    for (const key of ['watchStage', 'watchErrorCode']) {
      expect(sanitizeDiagnosticMetadata({ [key]: '/Users/private/project' })).toBeNull()
    }
    service.recordMainEvent({ event: 'watcher.work.summary', operationId: 'watch_create_1_1', metadata })
    await service.flush()
    const text = (await readAllLogBytes(defaultDirectory)).toString('utf8')
    expect(text).toContain('watch-created')
    expect((await service.getStatus()).invalidEvents).toBe(0)
  })

  it('监听独立活动与关闭尾窗可观测主线程停顿，且不泄漏根路径', async () => {
    const { service, defaultDirectory } = await createService()
    const record = vi.spyOn(service, 'recordMainEvent')
    const operationId = 'watch_create_1_1'
    const secretRoot = '/Users/private-sensitive-project'
    service.recordMainEvent({ event: 'watcher.work.start', operationId, rawWorkspacePath: secretRoot })
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 450)
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(record.mock.calls.some(([event]) => event.event === 'main.event-loop.window')).toBe(true)
    record.mockClear()
    service.recordMainEvent({ event: 'watcher.work.terminal', operationId, metadata: { watchErrorCount: 1, watchReason: 'resource' } })
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 450)
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(record.mock.calls.some(([event]) => event.event === 'main.event-loop.window')).toBe(true)
    service.recordMainEvent({ event: 'watcher.work.summary', metadata: { errorCode: 'private error text' } })
    await service.flush()
    const text = (await readAllLogBytes(defaultDirectory)).toString('utf8')
    expect(text).toContain('watcher.work.start')
    expect(text).not.toContain(secretRoot)
    expect(text).not.toContain('private error text')
  })

  it('批量写入有效事件，且原始路径不会进入 JSONL', async () => {
    const { service, defaultDirectory } = await createService()
    const secretPath = path.join(defaultDirectory, 'private-folder', 'secret-file.md')
    service.recordMainEvent({
      event: 'session.start',
      rawPath: secretPath,
      priority: 'critical',
    })
    service.recordRendererEvent(7, {
      schemaVersion: DIAGNOSTIC_EVENT_SCHEMA_VERSION,
      event: 'file.open.start',
      observedUnixMs: Date.now(),
      monotonicMs: 20,
      processInstanceId: 'renderer_12345678',
      processSeq: 1,
      operationId: 'operation_12345678',
      metadata: { source: 'user' },
    })
    service.recordRendererEvent(7, {
      schemaVersion: DIAGNOSTIC_EVENT_SCHEMA_VERSION,
      event: 'file.open.terminal',
      observedUnixMs: Date.now(),
      monotonicMs: 30,
      processInstanceId: 'renderer_12345678',
      processSeq: 2,
      operationId: 'operation_12345678',
      outcome: 'success',
    })

    await service.flush()
    const snapshot = await service.readEventsForBundle()
    const bytes = await readAllLogBytes(defaultDirectory)

    expect(snapshot.events.map(event => event.event)).toEqual([
      'session.start',
      'file.open.start',
      'file.open.terminal',
    ])
    expect(snapshot.events[0].pathToken).toMatch(/^path_[a-f0-9]{24}$/)
    expect(snapshot.events[0].tokenScope).toBe('installation')
    expect(bytes.includes(Buffer.from(secretPath))).toBe(false)
    expect(bytes.includes(Buffer.from('secret-file.md'))).toBe(false)
  })

  it('初始化期间入队的路径在写盘前使用最终安装 key 脱敏', async () => {
    const root = await createTempDirectory('mdv-event-early-path-')
    const defaultDirectory = path.join(root, 'logs')
    const service = new DiagnosticEventLogService()
    services.push(service)
    const secretPath = path.join(root, 'workspace', 'early-secret.md')
    service.initialize({
      defaultDirectory,
      userDataDirectory: path.join(root, 'user-data'),
      settings: undefined,
    })
    service.recordMainEvent({ event: 'file.io.summary', rawPath: secretPath })

    await waitForInitialization(service)
    await service.flush()
    const snapshot = await service.readEventsForBundle()
    expect(snapshot.events[0]).toMatchObject({
      event: 'file.io.summary',
      tokenScope: 'installation',
      pathToken: expect.stringMatching(/^path_[a-f0-9]{24}$/),
    })
    expect((await readAllLogBytes(defaultDirectory)).includes(Buffer.from(secretPath))).toBe(false)
  })

  it('同一 userData 的安装级路径 token 可跨启动关联', async () => {
    const root = await createTempDirectory('mdv-event-token-')
    const userDataDirectory = path.join(root, 'user-data')
    const targetPath = path.join(root, 'workspace', 'document.md')
    const tokens: string[] = []

    for (const name of ['first', 'second']) {
      const service = new DiagnosticEventLogService()
      services.push(service)
      service.initialize({
        defaultDirectory: path.join(root, `${name}-logs`),
        userDataDirectory,
        settings: undefined,
      })
      await waitForInitialization(service)
      service.recordMainEvent({ event: 'file.io.summary', rawPath: targetPath })
      await service.flush()
      const snapshot = await service.readEventsForBundle()
      tokens.push(snapshot.events[0].pathToken ?? '')
      await service.setEnabled(false)
    }

    expect(tokens[0]).toMatch(/^path_[a-f0-9]{24}$/)
    expect(tokens[1]).toBe(tokens[0])
  })

  it('自定义目录不可用时回退默认目录且不阻塞记录', async () => {
    const root = await createTempDirectory('mdv-event-fallback-')
    const defaultDirectory = path.join(root, 'logs')
    const unavailableDirectory = path.join(root, 'missing-volume', 'logs')
    const service = new DiagnosticEventLogService()
    services.push(service)
    service.initialize({
      defaultDirectory,
      userDataDirectory: path.join(root, 'user-data'),
      settings: {
        enabled: true,
        directory: unavailableDirectory,
        maxTotalMiB: 10,
        retentionDays: 7,
      },
    })
    await waitForInitialization(service)

    const status = await service.getStatus()
    expect(status.state).toBe('fallback')
    expect(status.configuredDirectory).toBe(unavailableDirectory)
    expect(status.effectiveDirectory).toBe(defaultDirectory)
    expect(status.lastErrorCode).toBe('DIRECTORY_UNAVAILABLE')

    await service.flush()
    expect((await readdir(defaultDirectory)).some(name => name.endsWith('.jsonl'))).toBe(true)
  })

  it('默认目录不可写时进入 error 且不影响调用方', async () => {
    const root = await createTempDirectory('mdv-event-default-error-')
    const defaultDirectory = path.join(root, 'not-a-directory')
    await writeFile(defaultDirectory, 'blocking file')
    const service = new DiagnosticEventLogService()
    services.push(service)
    service.initialize({
      defaultDirectory,
      userDataDirectory: path.join(root, 'user-data'),
      settings: undefined,
    })
    await waitForInitialization(service)

    expect(await service.getStatus()).toMatchObject({
      state: 'error',
      enabled: true,
      effectiveDirectory: null,
      lastErrorCode: 'DEFAULT_DIRECTORY_UNAVAILABLE',
    })
    expect(() => service.recordMainEvent({ event: 'session.start' })).not.toThrow()
  })

  it('保留规则只删除严格匹配的过期普通日志文件', async () => {
    const { service, defaultDirectory } = await createService()
    const oldLog = path.join(defaultDirectory, 'md-viewer-events-2026-01-01-aabbccddeeff-00.jsonl')
    const canary = path.join(defaultDirectory, 'do-not-delete.jsonl')
    await writeFile(oldLog, '{}\n')
    await writeFile(canary, 'CANARY')
    const oldTime = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000)
    await utimes(oldLog, oldTime, oldTime)
    await utimes(canary, oldTime, oldTime)

    const result = await service.applyRetentionPolicy({ maxTotalMiB: 10, retentionDays: 7 })

    expect(result.deletedFiles).toBe(1)
    await expect(access(oldLog)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(canary, 'utf8')).toBe('CANARY')
  })

  it('导出读取跳过损坏 JSONL 尾行并统计 invalidLines', async () => {
    const { service, defaultDirectory } = await createService()
    const malformed = path.join(
      defaultDirectory,
      'md-viewer-events-2026-09-10-aabbccddeeff-00.jsonl',
    )
    await writeFile(malformed, '{"schemaVersion":1\n')

    const snapshot = await service.readEventsForBundle()
    expect(snapshot.events).toEqual([])
    expect(snapshot.invalidLines).toBe(1)
  })

  it('容量超限时跳过近期仍活跃的其他启动日志', async () => {
    const { service, defaultDirectory } = await createService()
    const activeForeignLog = path.join(
      defaultDirectory,
      'md-viewer-events-2026-09-10-aabbccddeeff-00.jsonl',
    )
    await writeFile(activeForeignLog, '')
    await truncate(activeForeignLog, 11 * 1024 * 1024)

    const result = await service.applyRetentionPolicy({ maxTotalMiB: 10, retentionDays: 7 })

    expect(result.deletedFiles).toBe(0)
    expect(result.skippedActiveFiles).toBeGreaterThan(0)
    await expect(access(activeForeignLog)).resolves.toBeUndefined()
  })

  it('拒绝文件系统根目录和敏感目录本身，但允许精确默认目录', async () => {
    const { service, defaultDirectory } = await createService()
    await expect(service.validateCustomDirectory(defaultDirectory)).resolves.toBe(await realpath(defaultDirectory))
    await expect(service.validateCustomDirectory(path.parse(process.cwd()).root))
      .rejects.toMatchObject({ code: 'DIRECTORY_PROTECTED' })

    const sensitiveRoot = await createTempDirectory('mdv-sensitive-parent-')
    const sshDirectory = path.join(sensitiveRoot, '.ssh')
    await mkdir(sshDirectory)
    await expect(service.validateCustomDirectory(sshDirectory))
      .rejects.toMatchObject({ code: 'DIRECTORY_PROTECTED' })
  })

  it('关闭记录前先落盘既有队列，并拒绝关闭后的新事件', async () => {
    const { service } = await createService()
    service.recordMainEvent({ event: 'session.start', priority: 'critical' })

    await service.setEnabled(false)
    service.recordMainEvent({ event: 'session.end', priority: 'critical' })

    const snapshot = await service.readEventsForBundle()
    expect(snapshot.events.map(event => event.event)).toEqual(['session.start'])
    expect((await service.getStatus()).state).toBe('disabled')
  })

  it('shutdown 在预算内写入 writer health 和 session end', async () => {
    const { service } = await createService()
    service.recordMainEvent({ event: 'session.start' })

    await service.shutdown()

    const snapshot = await service.readEventsForBundle()
    expect(snapshot.events.map(event => event.event)).toEqual([
      'session.start',
      'diagnostic.writer.health',
      'session.end',
    ])
  })

  it('健康日志在正常活动时限频并为空闲实例保留低频心跳', async () => {
    const { service } = await createService()
    const monitor = service as unknown as { recordWriterHealth(force: boolean): void }
    const started = Date.now()
    let now = started
    vi.spyOn(Date, 'now').mockImplementation(() => now)

    service.recordMainEvent({ event: 'session.start' })
    monitor.recordWriterHealth(false)
    await service.flush()

    now = started + 60 * 1000
    monitor.recordWriterHealth(false)
    service.recordMainEvent({ event: 'clock.anchor' })
    now = started + 9 * 60 * 1000
    monitor.recordWriterHealth(false)
    await service.flush()
    let snapshot = await service.readEventsForBundle()
    expect(snapshot.events.filter(event => event.event === 'diagnostic.writer.health')).toHaveLength(1)

    now = started + 10 * 60 * 1000
    monitor.recordWriterHealth(false)
    await service.flush()
    snapshot = await service.readEventsForBundle()
    expect(snapshot.events.filter(event => event.event === 'diagnostic.writer.health')).toHaveLength(2)

    now = started + 39 * 60 * 1000
    monitor.recordWriterHealth(false)
    now = started + 40 * 60 * 1000
    monitor.recordWriterHealth(false)
    await service.flush()
    snapshot = await service.readEventsForBundle()
    expect(snapshot.events.filter(event => event.event === 'diagnostic.writer.health')).toHaveLength(3)
  })

  it('writer 异常变化不受正常十分钟限频影响', async () => {
    const { service } = await createService()
    const monitor = service as unknown as { recordWriterHealth(force: boolean): void }
    const started = Date.now()
    let now = started
    vi.spyOn(Date, 'now').mockImplementation(() => now)

    service.recordMainEvent({ event: 'session.start' })
    monitor.recordWriterHealth(false)
    await service.flush()

    now = started + 60 * 1000
    service.recordRendererEvent(7, { event: 'invalid.renderer.event' })
    monitor.recordWriterHealth(false)
    await service.flush()

    const healthEvents = (await service.readEventsForBundle()).events
      .filter(event => event.event === 'diagnostic.writer.health')
    expect(healthEvents).toHaveLength(2)
    expect(healthEvents[1].metadata).toMatchObject({ eventsInvalid: 1 })
  })

  it('成功但持续超过阈值的 append 标记为 degraded', async () => {
    const service = new DiagnosticEventLogService({
      appendFile: async (handle, content) => {
        await new Promise(resolve => setTimeout(resolve, 510))
        await handle.appendFile(content, 'utf8')
      },
    })
    services.push(service)
    const root = await createTempDirectory('mdv-event-degraded-')
    service.initialize({
      defaultDirectory: path.join(root, 'logs'),
      userDataDirectory: path.join(root, 'user-data'),
      settings: undefined,
    })
    await waitForInitialization(service)

    service.recordMainEvent({ event: 'session.start' })
    await service.flush()

    expect((await service.getStatus()).state).toBe('degraded')
    expect(service.getHealth().appendMaxMs).toBeGreaterThanOrEqual(500)
  })

  it('append 超时后切换 generation，迟到写入不会在 fallback 中重复', async () => {
    const root = await mkdtemp(path.join(homedir(), 'mdv-event-timeout-'))
    tempDirectories.push(root)
    const defaultDirectory = path.join(root, 'logs')
    const customDirectory = path.join(root, 'custom-logs')
    await mkdir(customDirectory)
    let appendCalls = 0
    const service = new DiagnosticEventLogService({
      writeTimeoutMs: 10,
      appendFile: async (handle, content) => {
        appendCalls += 1
        const write = handle.appendFile(content, 'utf8')
        if (appendCalls === 1) {
          await new Promise(resolve => setTimeout(resolve, 50))
        }
        await write
      },
    })
    services.push(service)
    service.initialize({
      defaultDirectory,
      userDataDirectory: path.join(root, 'user-data'),
      settings: {
        enabled: true,
        directory: customDirectory,
        maxTotalMiB: 10,
        retentionDays: 7,
      },
    })
    await waitForInitialization(service)

    service.recordMainEvent({ event: 'session.start', priority: 'critical' })
    await service.flush()
    await new Promise(resolve => setTimeout(resolve, 80))
    await service.flush()

    expect((await service.getStatus()).state).toBe('fallback')
    const customText = (await readAllLogBytes(customDirectory)).toString('utf8')
    const defaultText = (await readAllLogBytes(defaultDirectory)).toString('utf8')
    expect(customText.match(/"event":"session.start"/g)).toHaveLength(1)
    expect(defaultText).not.toContain('"event":"session.start"')
    expect(defaultText).toContain('"event":"diagnostic.destination.fallback"')
  })

  it('有界队列丢弃普通事件并为 critical 事件保留空间', async () => {
    const { service } = await createService()
    for (let index = 0; index < 10_000; index += 1) {
      service.recordMainEvent({
        event: 'file.io.summary',
        metadata: {
          durationMs: index,
          authorizationMs: index,
          statMs: index,
          readWallMs: index,
          mainHandlerMs: index,
        },
      })
    }
    service.recordMainEvent({ event: 'session.end', priority: 'critical' })

    expect(service.getHealth().maxQueueBytes).toBeLessThanOrEqual(1024 * 1024)
    expect(service.getHealth().droppedEvents).toBeGreaterThan(0)
    await service.flush()
    const snapshot = await service.readEventsForBundle()
    expect(snapshot.events.some(event => event.event === 'session.end')).toBe(true)
  })

  it('超过 2 MiB 时轮转到新的独占 segment', async () => {
    const { service, defaultDirectory } = await createService()
    for (let batch = 0; batch < 14; batch += 1) {
      for (let index = 0; index < 1_000; index += 1) {
        service.recordMainEvent({
          event: 'file.io.summary',
          metadata: {
            durationMs: index,
            authorizationMs: index,
            statMs: index,
            readWallMs: index,
            mainHandlerMs: index,
          },
        })
      }
      await service.flush()
    }

    const segments = (await readdir(defaultDirectory)).filter(name => name.endsWith('.jsonl'))
    expect(segments.length).toBeGreaterThan(1)
    const health = service.getHealth()
    expect(health.batchCount).toBeGreaterThan(1)
    expect(health.eventsWritten).toBe(14_000)
  })

  it('仅按同一 sender、kind 和 canonical path 查找活动 operation', async () => {
    const { service } = await createService()
    service.registerOperation(1, 'folder_12345678', 'folder', 'restore')
    service.bindRegisteredOperationPath(1, 'folder_12345678', '/workspace/root')

    expect(service.findRegisteredOperation(1, 'folder', '/workspace/root')).toEqual({
      operationId: 'folder_12345678',
      source: 'restore',
    })
    expect(service.findRegisteredOperation(2, 'folder', '/workspace/root')).toBeNull()
    expect(service.findRegisteredOperation(1, 'folder', '/workspace/other')).toBeNull()
    expect(service.findRegisteredOperation(1, 'file', '/workspace/root')).toBeNull()
  })

  it('拒绝跨 sender 串入 renderer operation', async () => {
    const { service } = await createService()
    const start = {
      schemaVersion: DIAGNOSTIC_EVENT_SCHEMA_VERSION,
      event: 'file.open.start',
      observedUnixMs: Date.now(),
      monotonicMs: 1,
      processInstanceId: 'renderer_12345678',
      processSeq: 1,
      operationId: 'operation_12345678',
    } as const
    service.recordRendererEvent(1, start)
    service.recordRendererEvent(2, {
      ...start,
      event: 'file.open.terminal',
      processSeq: 2,
      outcome: 'success',
    })
    await service.flush()

    const snapshot = await service.readEventsForBundle()
    expect(snapshot.events.map(event => event.event)).toEqual(['file.open.start'])
    expect(service.getHealth().invalidEvents).toBe(1)
  })
})
