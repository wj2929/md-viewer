import { BrowserWindow, ipcMain, dialog } from 'electron'
import path from 'node:path'
import { IPCContext } from './context'
import { activateFolderForWindow } from '../folderActivation'
import { validateSenderReadPath } from './senderSecurity'
import { workspaceTransferCoordinator, type WorkspaceTransferSnapshot } from '../workspaceTransferCoordinator'
import { workspaceSessionStore, type DesktopSessionRuntimeWindow } from '../workspaceSessionStore'
import type { WorkspacePresentation } from '../windowManager'
import { windowTransferCoordinator } from '../windowTransferCoordinator'

export function registerWindowHandlers(ctx: IPCContext): void {
  const cancelTransfer = (nonce: string, reason: string): void => {
    const transfer = workspaceTransferCoordinator.cancel(nonce)
    if (!transfer) return
    ctx.windowManager.sendToWindow(transfer.targetWindowId, 'workspace:transfer-cancelled', {
      nonce: transfer.nonce,
      reason,
    })
  }

  // 获取当前窗口 ID
  ipcMain.handle('window:getWindowId', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    return win ? win.id : null
  })

  ipcMain.handle('workspace:getBootstrap', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) throw new Error('安全错误：当前窗口无效')

    const activeWorkspaceId = ctx.windowManager.getActiveWorkspaceId(win.id)
    return {
      activeWorkspaceId,
      workspaces: ctx.windowManager.listWorkspaces(win.id).map((workspace) => ({
        id: workspace.id,
        primaryRoot: workspace.primaryRoot,
        lifecycleEpoch: workspace.lifecycleEpoch,
      })),
      restoredRuntime: workspaceSessionStore.takeRestoredRuntime(win.id),
    }
  })

  ipcMain.handle('workspace:saveDesktopRuntime', (event, runtime: DesktopSessionRuntimeWindow) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || !runtime || typeof runtime !== 'object' || !Array.isArray(runtime.workspaces)) {
      throw new Error('安全错误：工作区会话无效')
    }

    const registered = ctx.windowManager.listWorkspaces(win.id)
    const registeredIds = new Set(registered.map((workspace) => workspace.id))
    const isSuperseded = runtime.workspaces.some((workspace) => {
      const registeredWorkspace = workspace && ctx.windowManager.getWorkspace(win.id, workspace.id)
      return registeredWorkspace && Number.isInteger(workspace.lifecycleEpoch) && workspace.lifecycleEpoch < registeredWorkspace.lifecycleEpoch
    })
    if (isSuperseded) return

    if (
      runtime.workspaces.length !== registered.length ||
      runtime.workspaces.some((workspace) => !workspace || !registeredIds.has(workspace.id)) ||
      (runtime.activeWorkspaceId !== null && runtime.activeWorkspaceId !== ctx.windowManager.getActiveWorkspaceId(win.id))
    ) {
      throw new Error('安全错误：工作区会话与窗口不匹配')
    }

    const desktop = workspaceSessionStore.load() ?? { version: 1 as const, windows: [] }
    const snapshot = {
      id: workspaceSessionStore.getWindowSnapshotId(win.id),
      bounds: win.getBounds(),
      isMaximized: win.isMaximized(),
      alwaysOnTop: win.isAlwaysOnTop(),
      activeWorkspaceId: runtime.activeWorkspaceId,
      workspaces: runtime.workspaces.map((workspace) => {
        const registeredWorkspace = ctx.windowManager.getWorkspace(win.id, workspace.id)
        if (!registeredWorkspace || workspace.tabs.length > 100) {
          throw new Error('安全错误：工作区会话内容无效')
        }
        if (
          workspace.primaryRoot !== registeredWorkspace.primaryRoot ||
          !Number.isInteger(workspace.lifecycleEpoch) ||
          workspace.lifecycleEpoch !== registeredWorkspace.lifecycleEpoch
        ) {
          if (Number.isInteger(workspace.lifecycleEpoch) && workspace.lifecycleEpoch < registeredWorkspace.lifecycleEpoch) {
            return null
          }
          throw new Error('安全错误：工作区会话内容无效')
        }
        return {
          id: workspace.id,
          name: typeof workspace.name === 'string' ? workspace.name.slice(0, 200) : '未命名工作区',
          primaryRoot: registeredWorkspace.primaryRoot,
          lifecycleEpoch: registeredWorkspace.lifecycleEpoch,
          tabs: workspace.tabs.map((tab) => ({
            id: tab.id,
            relativePath: registeredWorkspace.primaryRoot && typeof tab.filePath === 'string'
              ? path.relative(registeredWorkspace.primaryRoot, tab.filePath)
              : '',
            isPinned: Boolean(tab.isPinned),
          })).filter((tab) => tab.relativePath && !tab.relativePath.startsWith('..') && !path.isAbsolute(tab.relativePath)),
          activeTabId: workspace.activeTabId,
          splitState: workspace.splitState,
        }
      }).filter((workspace): workspace is NonNullable<typeof workspace> => workspace !== null),
    }
    workspaceSessionStore.save({
      version: 1,
      windows: [...desktop.windows.filter((item) => item.id !== snapshot.id), snapshot],
    })
  })

  ipcMain.handle('workspace:requestPendingSource', (event) => {
    const target = BrowserWindow.fromWebContents(event.sender)
    if (!target) throw new Error('安全错误：当前窗口无效')
    const awaitingTransfer = workspaceTransferCoordinator.getAwaitingSourceForTarget(target.id)
    if (!awaitingTransfer) return null

    const transfer = workspaceTransferCoordinator.requestSourceForTarget(awaitingTransfer.nonce, target.id)
    ctx.windowManager.sendToWindow(transfer.sourceWindowId, 'workspace:export-requested', {
      nonce: transfer.nonce,
      workspaceId: transfer.workspaceId,
      sourceLifecycleEpoch: transfer.sourceLifecycleEpoch,
      targetWindowId: target.id,
    })
    return { nonce: transfer.nonce }
  })

  ipcMain.handle('workspace:activate', (event, workspaceId: string) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || typeof workspaceId !== 'string') throw new Error('安全错误：工作区无效')
    const workspace = ctx.windowManager.activateWorkspace(win.id, workspaceId)
    return { id: workspace.id, primaryRoot: workspace.primaryRoot, lifecycleEpoch: workspace.lifecycleEpoch }
  })

  ipcMain.handle('workspace:create', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) throw new Error('安全错误：当前窗口无效')
    const workspace = ctx.windowManager.createWorkspace(win.id)
    ctx.windowManager.activateWorkspace(win.id, workspace.id)
    const descriptor = { id: workspace.id, primaryRoot: workspace.primaryRoot, lifecycleEpoch: workspace.lifecycleEpoch }
    win.webContents.send('workspace:created', descriptor)
    return descriptor
  })

  ipcMain.handle('workspace:close', (event, workspaceId: string) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || typeof workspaceId !== 'string') throw new Error('安全错误：工作区无效')
    const removed = ctx.windowManager.closeWorkspace(win.id, workspaceId)
    if (!removed) throw new Error('安全错误：工作区不存在或不属于当前窗口')
    if (ctx.windowManager.listWorkspaces(win.id).length === 0) {
      ctx.windowManager.createWorkspace(win.id)
    }
    return { activeWorkspaceId: ctx.windowManager.getActiveWorkspaceId(win.id) }
  })

  ipcMain.handle('workspace:pruneInactive', (event, request: {
    expectedActiveWorkspaceId: string
    candidates: Array<{ workspaceId: string; lifecycleEpoch: number; primaryRoot: string | null }>
  }) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (
      !win ||
      !request ||
      typeof request.expectedActiveWorkspaceId !== 'string' ||
      !Array.isArray(request.candidates) ||
      request.candidates.length > 12 ||
      request.candidates.some((candidate) =>
        !candidate ||
        typeof candidate.workspaceId !== 'string' ||
        !Number.isInteger(candidate.lifecycleEpoch) ||
        candidate.lifecycleEpoch < 1 ||
        (candidate.primaryRoot !== null && typeof candidate.primaryRoot !== 'string')
      )
    ) throw new Error('安全错误：工作区清理请求无效')
    if (workspaceTransferCoordinator.isWindowReserved(win.id) || windowTransferCoordinator.isWindowReserved(win.id)) {
      throw new Error('窗口正在进行工作区转移')
    }
    const removedWorkspaceIds = ctx.windowManager.pruneInactiveWorkspaces(
      win.id,
      request.expectedActiveWorkspaceId,
      request.candidates
    )
    return { removedWorkspaceIds, activeWorkspaceId: ctx.windowManager.getActiveWorkspaceId(win.id) }
  })

  ipcMain.handle('workspace:updatePresentations', (event, presentations: WorkspacePresentation[]) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || !Array.isArray(presentations) || presentations.length > 12) {
      throw new Error('安全错误：工作区展示信息无效')
    }
    const normalized = presentations.map((presentation) => {
      if (
        !presentation ||
        typeof presentation.workspaceId !== 'string' ||
        typeof presentation.label !== 'string' ||
        !Number.isInteger(presentation.tabCount) || presentation.tabCount < 0 || presentation.tabCount > 100 ||
        !Array.isArray(presentation.tabNames) || presentation.tabNames.length > 5
      ) throw new Error('安全错误：工作区展示信息无效')
      return {
        workspaceId: presentation.workspaceId,
        label: presentation.label.trim().slice(0, 120) || '空白会话',
        isEmptyPlaceholder: Boolean(presentation.isEmptyPlaceholder),
        hasMeaningfulState: typeof presentation.hasMeaningfulState === 'boolean'
          ? presentation.hasMeaningfulState
          : presentation.tabCount > 0 || Boolean(presentation.hasSplit) || Boolean(presentation.hasDraft),
        tabCount: presentation.tabCount,
        activeTabName: typeof presentation.activeTabName === 'string' ? presentation.activeTabName.slice(0, 200) : null,
        tabNames: presentation.tabNames
          .filter((name): name is string => typeof name === 'string')
          .map((name) => name.slice(0, 200)),
        hasSplit: Boolean(presentation.hasSplit),
        hasDraft: Boolean(presentation.hasDraft),
      }
    })
    ctx.windowManager.setWorkspacePresentations(win.id, normalized)
  })

  ipcMain.handle('workspace:listMergeSources', (event) => {
    const target = BrowserWindow.fromWebContents(event.sender)
    if (!target) throw new Error('安全错误：当前窗口无效')

    const sources = ctx.windowManager.getAllWindows()
      .filter((window) => window.id !== target.id)
      .map((window) => {
        const activeWorkspaceId = ctx.windowManager.getActiveWorkspaceId(window.id)
        const candidates = ctx.windowManager.listWorkspaces(window.id)
          .map((workspace) => {
            const presentation = ctx.windowManager.getWorkspacePresentation(window.id, workspace.id)
            return {
              id: workspace.id,
              label: presentation?.label || workspace.primaryRoot?.split(/[/\\]/).pop() || '空白会话',
              tabCount: presentation?.tabCount ?? 0,
              activeTabName: presentation?.activeTabName ?? null,
              hasSplit: presentation?.hasSplit ?? false,
              hasDraft: presentation?.hasDraft ?? false,
              hasMeaningfulState: presentation?.hasMeaningfulState ?? false,
              hasPresentation: Boolean(presentation),
              isEmptyPlaceholder: presentation?.isEmptyPlaceholder ?? !workspace.primaryRoot,
            }
          })
          .filter((workspace) => workspace.hasPresentation && workspace.hasMeaningfulState)
        const labelCounts = new Map<string, number>()
        const workspaces = candidates.map((workspace) => {
          const occurrence = (labelCounts.get(workspace.label) ?? 0) + 1
          labelCounts.set(workspace.label, occurrence)
          const states: string[] = []
          if (workspace.activeTabName) states.push(`当前：${workspace.activeTabName}`)
          states.push(workspace.tabCount > 0 ? `${workspace.tabCount} 个标签` : '无打开标签页')
          if (workspace.hasSplit) states.push('分屏')
          if (workspace.hasDraft) states.push('有草稿')
          return {
            id: workspace.id,
            name: occurrence > 1 ? `${workspace.label}（会话 ${occurrence}）` : workspace.label,
            summary: states.join(' · '),
          }
        })
        const activeLabel = candidates.find((workspace) => workspace.id === activeWorkspaceId)?.label
          || ctx.windowManager.getWorkspacePresentation(window.id, activeWorkspaceId ?? '')?.label
          || ctx.windowManager.getActiveWorkspace(window.id)?.primaryRoot?.split(/[/\\]/).pop()
          || '空白窗口'
        const tabCount = candidates.reduce((total, workspace) => total + workspace.tabCount, 0)
        const states = workspaces.length > 0 ? [`${workspaces.length} 个会话`] : ['无打开会话']
        if (tabCount > 0) states.push(`${tabCount} 个标签`)
        if (candidates.some((workspace) => workspace.hasSplit)) states.push('含分屏')
        if (candidates.some((workspace) => workspace.hasDraft)) states.push('含草稿')
        return {
          windowId: window.id,
          activeLabel,
          states,
          workspaces,
        }
      })
      .filter((source) => source.workspaces.length > 0)

    return sources.map((source, sourceIndex) => ({
      windowId: source.windowId,
      title: `窗口 ${sourceIndex + 1} · ${source.activeLabel}`,
      workspaceCount: source.workspaces.length,
      summary: source.states.join(' · '),
      workspaces: source.workspaces,
    }))
  })

  ipcMain.handle('workspace:splitActive', (event, workspaceId: string) => {
    const source = BrowserWindow.fromWebContents(event.sender)
    if (!source || typeof workspaceId !== 'string') throw new Error('安全错误：工作区拆分请求无效')
    const sourceWorkspace = ctx.windowManager.getWorkspace(source.id, workspaceId)
    if (!sourceWorkspace) {
      throw new Error('安全错误：工作区不存在或不属于当前窗口')
    }

    const target = ctx.windowManager.createWindow()
    const targetPlaceholder = ctx.windowManager.getActiveWorkspace(target.id)
    if (!targetPlaceholder) {
      ctx.windowManager.closeWindow(target.id)
      throw new Error('工作区转移目标初始化失败')
    }
    const transfer = workspaceTransferCoordinator.begin({
      sourceWindowId: source.id,
      targetWindowId: target.id,
      workspaceId,
      sourceLifecycleEpoch: sourceWorkspace.lifecycleEpoch,
      targetReservation: {
        workspaceId: targetPlaceholder.id,
        lifecycleEpoch: targetPlaceholder.lifecycleEpoch,
      },
    })
    return { nonce: transfer.nonce, targetWindowId: target.id }
  })

  ipcMain.handle('workspace:beginWindowTransfer', (event, sourceWindowId: number) => {
    const target = BrowserWindow.fromWebContents(event.sender)
    const source = ctx.windowManager.getWindow(sourceWindowId)
    if (!target || !source || source.id === target.id) throw new Error('该窗口已关闭，请刷新候选列表')
    const sourceWorkspaces = ctx.windowManager.listWorkspaces(source.id)
    const presentations = sourceWorkspaces.map((workspace) => ({
      workspace,
      presentation: ctx.windowManager.getWorkspacePresentation(source.id, workspace.id),
    }))
    if (presentations.some((item) => !item.presentation)) {
      throw new Error('该窗口的会话仍在恢复，请稍后重试')
    }
    const workspaces = presentations
      .filter((item) => item.presentation!.hasMeaningfulState)
      .map(({ workspace }) => ({
        workspaceId: workspace.id,
        sourceLifecycleEpoch: workspace.lifecycleEpoch,
        primaryRoot: workspace.primaryRoot,
      }))
    if (workspaces.length === 0) {
      ctx.windowManager.closeWindow(source.id)
      return { nonce: null, closedEmptyWindow: true }
    }
    const transfer = windowTransferCoordinator.begin({
      sourceWindowId: source.id,
      targetWindowId: target.id,
      sourceActiveWorkspaceId: ctx.windowManager.getActiveWorkspaceId(source.id),
      workspaces,
    })
    source.webContents.send('workspace:window-export-requested', transfer)
    return { nonce: transfer.nonce, closedEmptyWindow: false }
  })

  ipcMain.handle('workspace:submitWindowTransferSnapshots', async (event, nonce: string, snapshots: WorkspaceTransferSnapshot[]) => {
    const source = BrowserWindow.fromWebContents(event.sender)
    if (!source || !Array.isArray(snapshots)) throw new Error('安全错误：窗口合并快照无效')
    try {
      for (const snapshot of snapshots) {
        for (const tab of snapshot.tabs) await validateSenderReadPath(ctx, event, tab.filePath)
      }
      const transfer = windowTransferCoordinator.submitSnapshots(nonce, source.id, snapshots)
      ctx.windowManager.sendToWindow(transfer.targetWindowId, 'workspace:window-transfer-ready', { nonce })
    } catch (error) {
      const transfer = windowTransferCoordinator.cancel(nonce)
      if (transfer) ctx.windowManager.sendToWindow(transfer.targetWindowId, 'workspace:transfer-cancelled', { nonce, reason: error instanceof Error ? error.message : '窗口合并失败' })
      throw error
    }
  })

  ipcMain.handle('workspace:consumeWindowTransferSnapshots', (event, nonce: string) => {
    const target = BrowserWindow.fromWebContents(event.sender)
    if (!target) throw new Error('安全错误：当前窗口无效')
    return windowTransferCoordinator.getSnapshotsForTarget(nonce, target.id)
  })

  ipcMain.handle('workspace:stageWindowTransfer', (event, nonce: string) => {
    const target = BrowserWindow.fromWebContents(event.sender)
    if (!target) throw new Error('安全错误：当前窗口无效')
    windowTransferCoordinator.markTargetReady(nonce, target.id)
  })

  ipcMain.handle('workspace:completeWindowTransfer', (event, nonce: string) => {
    const target = BrowserWindow.fromWebContents(event.sender)
    if (!target) throw new Error('安全错误：当前窗口无效')
    const transfer = windowTransferCoordinator.completeForTarget(nonce, target.id)
    const source = ctx.windowManager.getWindow(transfer.sourceWindowId)
    if (!source) {
      windowTransferCoordinator.cancel(nonce)
      throw new Error('该窗口已关闭，请刷新候选列表')
    }
    const result = ctx.windowManager.transferWorkspaces(
      source.id,
      target.id,
      transfer.workspaces.map((workspace) => ({
        workspaceId: workspace.workspaceId,
        lifecycleEpoch: workspace.sourceLifecycleEpoch,
        primaryRoot: workspace.primaryRoot,
      })),
      transfer.sourceActiveWorkspaceId
    )
    windowTransferCoordinator.commit(nonce)
    ctx.windowManager.closeWindow(source.id)
    return result
  })

  ipcMain.handle('workspace:cancelWindowTransfer', (event, nonce: string) => {
    const caller = BrowserWindow.fromWebContents(event.sender)
    if (!caller) throw new Error('安全错误：当前窗口无效')
    const transfer = windowTransferCoordinator.cancelForParticipant(nonce, caller.id)
    if (transfer) ctx.windowManager.sendToWindow(transfer.targetWindowId, 'workspace:transfer-cancelled', { nonce, reason: '已取消窗口合并' })
  })

  ipcMain.handle('workspace:beginTransfer', (event, sourceWindowId: number, workspaceId: string) => {
    const target = BrowserWindow.fromWebContents(event.sender)
    if (!target || !Number.isInteger(sourceWindowId) || typeof workspaceId !== 'string') {
      throw new Error('安全错误：工作区转移请求无效')
    }

    const source = ctx.windowManager.getWindow(sourceWindowId)
    const workspace = source && ctx.windowManager.getWorkspace(source.id, workspaceId)
    if (!source || !workspace) throw new Error('该会话已关闭，请刷新候选列表')

    const transfer = workspaceTransferCoordinator.begin({
      sourceWindowId: source.id,
      targetWindowId: target.id,
      workspaceId,
      sourceLifecycleEpoch: workspace.lifecycleEpoch,
    })
    workspaceTransferCoordinator.markSourceRequested(transfer.nonce, source.id)
    source.webContents.send('workspace:export-requested', {
      nonce: transfer.nonce,
      workspaceId,
      sourceLifecycleEpoch: transfer.sourceLifecycleEpoch,
      targetWindowId: target.id,
    })
    return { nonce: transfer.nonce }
  })

  ipcMain.handle('workspace:submitTransferSnapshot', async (event, nonce: string, snapshot: WorkspaceTransferSnapshot) => {
    const source = BrowserWindow.fromWebContents(event.sender)
    if (!source || typeof nonce !== 'string' || !snapshot || typeof snapshot !== 'object') {
      throw new Error('安全错误：工作区快照无效')
    }
    const registeredWorkspace = ctx.windowManager.getWorkspace(source.id, snapshot.workspaceId)
    if (
      !registeredWorkspace ||
      registeredWorkspace.primaryRoot !== snapshot.primaryRoot ||
      registeredWorkspace.lifecycleEpoch !== snapshot.lifecycleEpoch
    ) {
      cancelTransfer(nonce, '工作区 generation 与快照不匹配')
      throw new Error('安全错误：工作区 generation 与快照不匹配')
    }
    try {
      for (const tab of snapshot.tabs) {
        await validateSenderReadPath(ctx, event, tab.filePath)
      }
      const transfer = workspaceTransferCoordinator.submitSnapshot(nonce, source.id, snapshot)
      ctx.windowManager.sendToWindow(transfer.targetWindowId, 'workspace:transfer-ready', { nonce })
    } catch (error) {
      cancelTransfer(nonce, error instanceof Error ? error.message : '工作区快照提交失败')
      throw error
    }
  })

  ipcMain.handle('workspace:consumeTransferSnapshot', (event, nonce: string) => {
    const target = BrowserWindow.fromWebContents(event.sender)
    if (!target || typeof nonce !== 'string') throw new Error('安全错误：工作区快照请求无效')
    return workspaceTransferCoordinator.getSnapshotForTarget(nonce, target.id)
  })

  ipcMain.handle('workspace:stageTransfer', (event, nonce: string) => {
    const target = BrowserWindow.fromWebContents(event.sender)
    if (!target || typeof nonce !== 'string') throw new Error('安全错误：工作区快照确认无效')
    workspaceTransferCoordinator.markTargetReady(nonce, target.id)
  })

  ipcMain.handle('workspace:completeTransfer', (event, nonce: string) => {
    const target = BrowserWindow.fromWebContents(event.sender)
    if (!target || typeof nonce !== 'string') throw new Error('安全错误：工作区转移确认无效')
    const transfer = workspaceTransferCoordinator.completeForTarget(nonce, target.id)
    const snapshot = workspaceTransferCoordinator.getSnapshotForTarget(nonce, target.id)
    const sourceWorkspace = ctx.windowManager.getWorkspace(transfer.sourceWindowId, snapshot.workspaceId)
    if (
      !sourceWorkspace ||
      sourceWorkspace.primaryRoot !== snapshot.primaryRoot ||
      sourceWorkspace.lifecycleEpoch !== snapshot.lifecycleEpoch
    ) {
      cancelTransfer(nonce, '工作区 generation 在导入期间已变化')
      throw new Error('安全错误：工作区 generation 在导入期间已变化')
    }
    if (sourceWorkspace.lifecycleEpoch !== transfer.sourceLifecycleEpoch) {
      cancelTransfer(nonce, '工作区 epoch 与转移请求不匹配')
      throw new Error('安全错误：工作区 epoch 与转移请求不匹配')
    }
    const targetReservation = transfer.targetReservation
    if (targetReservation) {
      const placeholder = ctx.windowManager.getWorkspace(target.id, targetReservation.workspaceId)
      if (
        !placeholder ||
        placeholder.lifecycleEpoch !== targetReservation.lifecycleEpoch ||
        placeholder.primaryRoot !== null
      ) {
        cancelTransfer(nonce, '工作区转移目标已变化')
        throw new Error('安全错误：工作区转移目标已变化')
      }
    }
    let workspace
    try {
      workspace = ctx.windowManager.transferWorkspace(
        transfer.sourceWindowId,
        target.id,
        snapshot.workspaceId,
        targetReservation
      )
    } catch (error) {
      cancelTransfer(nonce, error instanceof Error ? error.message : '工作区转移失败')
      throw error
    }
    workspaceTransferCoordinator.commitForTarget(nonce, target.id)
    ctx.windowManager.sendToWindow(transfer.sourceWindowId, 'workspace:transferred-out', {
      workspaceId: snapshot.workspaceId,
      activeWorkspaceId: ctx.windowManager.getActiveWorkspaceId(transfer.sourceWindowId),
    })
    if (ctx.windowManager.listWorkspaces(transfer.sourceWindowId).length === 0) {
      ctx.windowManager.closeWindow(transfer.sourceWindowId)
    } else {
      ctx.windowManager.notifyMergeSourcesChanged()
    }
    return { id: workspace.id, primaryRoot: workspace.primaryRoot, lifecycleEpoch: workspace.lifecycleEpoch }
  })

  ipcMain.handle('workspace:cancelTransfer', (event, nonce: string) => {
    const caller = BrowserWindow.fromWebContents(event.sender)
    if (!caller || typeof nonce !== 'string') throw new Error('安全错误：工作区转移取消无效')
    const transfer = workspaceTransferCoordinator.cancelForParticipant(nonce, caller.id)
    if (transfer) {
      ctx.windowManager.sendToWindow(transfer.targetWindowId, 'workspace:transfer-cancelled', {
        nonce: transfer.nonce,
        reason: '已取消工作区导入',
      })
    }
  })

  // 创建新窗口
  ipcMain.handle('window:newWindow', () => {
    const win = ctx.windowManager.createWindow()
    return win.id
  })

  // 创建新窗口并打开文件夹
  ipcMain.handle('window:newWindowWithFolder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    const folderPath = result.filePaths[0]
    const win = ctx.windowManager.createWindow()

    ctx.windowManager.addPendingAction(win.id, () => {
      activateFolderForWindow(ctx, win, folderPath, { notifyRenderer: true }).catch((error) => {
        console.error('[newWindowWithFolder] Failed to activate folder:', error)
      })
    })

    return win.id
  })

  // 获取窗口数量
  ipcMain.handle('window:getWindowCount', () => {
    return ctx.windowManager.getWindowCount()
  })

  // 设置窗口置顶
  ipcMain.handle('window:setAlwaysOnTop', async (event, flag: boolean) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return false
    win.setAlwaysOnTop(flag)
    ctx.store.set('alwaysOnTop', flag)
    return flag
  })

  // 获取窗口置顶状态
  ipcMain.handle('window:getAlwaysOnTop', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    return win?.isAlwaysOnTop() ?? false
  })

  // 切换窗口置顶
  ipcMain.handle('window:toggleAlwaysOnTop', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return false
    const newState = !win.isAlwaysOnTop()
    win.setAlwaysOnTop(newState)
    ctx.store.set('alwaysOnTop', newState)
    win.webContents.send('alwaysOnTop:changed', newState)
    return newState
  })

  // 设置全屏
  ipcMain.handle('window:setFullScreen', async (event, flag: boolean) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return false
    win.setFullScreen(flag)
    return flag
  })

  // 获取全屏状态
  ipcMain.handle('window:isFullScreen', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    return win?.isFullScreen() ?? false
  })

  // 切换全屏
  ipcMain.handle('window:toggleFullScreen', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return false
    const newState = !win.isFullScreen()
    win.setFullScreen(newState)
    return newState
  })

  // 打印功能
  ipcMain.handle('window:print', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return { success: false }

    win.webContents.print({
      silent: false,
      printBackground: true,
      margins: {
        marginType: 'default'
      }
    })
    return { success: true }
  })
}
