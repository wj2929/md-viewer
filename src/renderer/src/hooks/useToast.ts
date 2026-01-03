import { useState, useCallback } from 'react'
import { ToastMessage, ToastType } from '../components/Toast'

let toastId = 0

export function useToast() {
  const [messages, setMessages] = useState<ToastMessage[]>([])

  const showToast = useCallback((type: ToastType, message: string, duration?: number) => {
    const id = `toast-${++toastId}`
    setMessages(prev => [...prev, { id, type, message, duration }])
    return id
  }, [])

  const success = useCallback((message: string, duration?: number) => {
    return showToast('success', message, duration)
  }, [showToast])

  const error = useCallback((message: string, duration?: number) => {
    return showToast('error', message, duration)
  }, [showToast])

  const warning = useCallback((message: string, duration?: number) => {
    return showToast('warning', message, duration)
  }, [showToast])

  const info = useCallback((message: string, duration?: number) => {
    return showToast('info', message, duration)
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
