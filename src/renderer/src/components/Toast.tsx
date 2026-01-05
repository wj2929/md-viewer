import { useEffect, useState } from 'react'
import './Toast.css'

export type ToastType = 'success' | 'error' | 'info' | 'warning'

export interface ToastAction {
  label: string
  onClick: () => void
}

export interface ToastMessage {
  id: string
  type: ToastType
  message: string
  duration?: number
  action?: ToastAction
}

interface ToastProps {
  message: ToastMessage
  onClose: (id: string) => void
}

function Toast({ message, onClose }: ToastProps): JSX.Element {
  const [isExiting, setIsExiting] = useState(false)

  useEffect(() => {
    const duration = message.duration || 3000
    const timer = setTimeout(() => {
      setIsExiting(true)
      setTimeout(() => onClose(message.id), 300) // 等待退出动画
    }, duration)

    return () => clearTimeout(timer)
  }, [message, onClose])

  const handleClose = () => {
    setIsExiting(true)
    setTimeout(() => onClose(message.id), 300)
  }

  const handleAction = () => {
    if (message.action) {
      message.action.onClick()
      handleClose()
    }
  }

  const icons = {
    success: '✓',
    error: '✕',
    info: 'ℹ',
    warning: '⚠'
  }

  return (
    <div className={`toast toast-${message.type} ${isExiting ? 'toast-exit' : 'toast-enter'}`}>
      <span className="toast-icon">{icons[message.type]}</span>
      <span className="toast-message">{message.message}</span>
      {message.action && (
        <button className="toast-action" onClick={handleAction}>
          {message.action.label}
        </button>
      )}
      <button className="toast-close" onClick={handleClose}>
        ✕
      </button>
    </div>
  )
}

interface ToastContainerProps {
  messages: ToastMessage[]
  onClose: (id: string) => void
}

export function ToastContainer({ messages, onClose }: ToastContainerProps): JSX.Element {
  return (
    <div className="toast-container">
      {messages.map(msg => (
        <Toast key={msg.id} message={msg} onClose={onClose} />
      ))}
    </div>
  )
}
