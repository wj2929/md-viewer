import { create } from 'zustand'
import type { PreflightResult } from '../../../shared/preflight'

/**
 * 导出前预检的模态状态。request(result) 显示面板并返回一个 Promise，
 * 用户点「继续/取消」时 respond() 兑现该 Promise —— 让导出流程能 await 用户决策。
 */
interface PreflightState {
  visible: boolean
  result: PreflightResult | null
  resolver: ((proceed: boolean) => void) | null
  request: (result: PreflightResult) => Promise<boolean>
  respond: (proceed: boolean) => void
}

export const usePreflightStore = create<PreflightState>((set, get) => ({
  visible: false,
  result: null,
  resolver: null,
  request: (result) =>
    new Promise<boolean>(resolve => {
      set({ visible: true, result, resolver: resolve })
    }),
  respond: (proceed) => {
    get().resolver?.(proceed)
    set({ visible: false, result: null, resolver: null })
  },
}))
