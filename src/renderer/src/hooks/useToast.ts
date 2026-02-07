import { useState, useCallback } from 'react'
import { ToastMessage, ToastType, ToastAction } from '../components/Toast'

let toastId = 0

export interface ToastOptions {
  description?: string  // 可选的描述文本
  duration?: number
  action?: ToastAction
}

export function useToast() {
  const [messages, setMessages] = useState<ToastMessage[]>([])

  const showToast = useCallback((type: ToastType, message: string, options?: ToastOptions) => {
    const id = `toast-${++toastId}`
    setMessages(prev => [...prev, {
      id,
      type,
      message,
      description: options?.description,
      duration: options?.duration,
      action: options?.action
    }])
    return id
  }, [])

  const success = useCallback((message: string, options?: ToastOptions) => {
    return showToast('success', message, options)
  }, [showToast])

  const error = useCallback((message: string, options?: ToastOptions) => {
    return showToast('error', message, options)
  }, [showToast])

  const warning = useCallback((message: string, options?: ToastOptions) => {
    return showToast('warning', message, options)
  }, [showToast])

  const info = useCallback((message: string, options?: ToastOptions) => {
    return showToast('info', message, options)
  }, [showToast])

  const closeToast = useCallback((id: string) => {
    setMessages(prev => prev.filter(msg => msg.id !== id))
  }, [])

  return {
    messages,
    success,
    error,
    warning,
    info,
    close: closeToast
  }
}
