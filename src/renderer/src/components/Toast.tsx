import { useEffect, useState } from 'react'
import './Toast.css'

export type ToastType = 'success' | 'error' | 'info' | 'warning'

export interface ToastAction {
  label: string
  onClick: () => void
}

export interface ToastProgress {
  current: number
  total: number
  label?: string
  cancelable?: boolean
  onCancel?: () => void
}

export interface ToastMessage {
  id: string
  type: ToastType
  message: string
  description?: string
  duration?: number
  action?: ToastAction
  actions?: ToastAction[]
  progress?: ToastProgress
}

interface ToastProps {
  message: ToastMessage
  onClose: (id: string) => void
}

function Toast({ message, onClose }: ToastProps): JSX.Element {
  const [isExiting, setIsExiting] = useState(false)

  useEffect(() => {
    if (message.progress) return
    const duration = message.duration || 3000
    const timer = setTimeout(() => {
      setIsExiting(true)
      setTimeout(() => onClose(message.id), 300)
    }, duration)

    return () => clearTimeout(timer)
  }, [message, onClose])

  const handleClose = () => {
    setIsExiting(true)
    setTimeout(() => onClose(message.id), 300)
  }

  const handleAction = (action: ToastAction) => {
    action.onClick()
    handleClose()
  }

  const icons = {
    success: '✓',
    error: '✕',
    info: 'ℹ',
    warning: '⚠'
  }

  const progress = message.progress
  const percent = progress ? Math.round((progress.current / progress.total) * 100) : 0

  return (
    <div className={`toast toast-${message.type} ${isExiting ? 'toast-exit' : 'toast-enter'}`}>
      <span className="toast-icon">{icons[message.type]}</span>
      <div className="toast-content">
        <div className="toast-message">{message.message}</div>
        {message.description && (
          <div className="toast-description">{message.description}</div>
        )}
        {progress && (
          <>
            {progress.label && <div className="toast-progress-label">{progress.label}</div>}
            <div className="toast-progress-track">
              <div className="toast-progress-fill" style={{ width: `${percent}%` }} />
            </div>
            <div className="toast-progress-percent">{percent}%</div>
          </>
        )}
      </div>
      <div className="toast-actions-col">
        {message.action && (
          <button className="toast-action" onClick={() => handleAction(message.action!)}>
            {message.action.label}
          </button>
        )}
        {message.actions && message.actions.map((a, i) => (
          <button key={i} className="toast-action" onClick={() => handleAction(a)}>
            {a.label}
          </button>
        ))}
        {progress?.cancelable && progress.onCancel && (
          <button className="toast-action toast-cancel-btn" onClick={progress.onCancel}>
            取消
          </button>
        )}
        <button className="toast-close" onClick={handleClose}>
          ✕
        </button>
      </div>
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
