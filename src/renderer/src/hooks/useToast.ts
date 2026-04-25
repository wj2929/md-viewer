import { useState, useCallback } from 'react'
import { ToastMessage, ToastType, ToastAction, ToastProgress } from '../components/Toast'

let toastId = 0

export interface ToastOptions {
  description?: string
  duration?: number
  action?: ToastAction
  actions?: ToastAction[]
  progress?: ToastProgress
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
      action: options?.action,
      actions: options?.actions,
      progress: options?.progress,
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

  const updateToast = useCallback((id: string, updates: Partial<Pick<ToastMessage, 'message' | 'description' | 'progress' | 'action' | 'actions' | 'type'>>) => {
    setMessages(prev => prev.map(msg =>
      msg.id === id ? { ...msg, ...updates } : msg
    ))
  }, [])

  return {
    messages,
    success,
    error,
    warning,
    info,
    close: closeToast,
    update: updateToast,
  }
}
