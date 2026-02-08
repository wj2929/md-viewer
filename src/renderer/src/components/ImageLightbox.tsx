/**
 * v1.5.1: 图片 Lightbox 预览组件
 * 支持缩放、拖拽平移、左右切换、键盘操作
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import './ImageLightbox.css'

export interface LightboxState {
  src: string
  alt: string
  images: string[]
  currentIndex: number
}

interface ImageLightboxProps {
  state: LightboxState
  onClose: () => void
  onNavigate: (index: number) => void
}

export function ImageLightbox({ state, onClose, onNavigate }: ImageLightboxProps): JSX.Element {
  const { src, alt, images, currentIndex } = state
  const [scale, setScale] = useState(1)
  const [translate, setTranslate] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const dragStart = useRef({ x: 0, y: 0 })
  const translateStart = useRef({ x: 0, y: 0 })

  // 重置缩放和平移（切换图片时）
  useEffect(() => {
    setScale(1)
    setTranslate({ x: 0, y: 0 })
  }, [currentIndex])

  // 键盘事件
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'Escape':
          onClose()
          break
        case 'ArrowLeft':
          if (currentIndex > 0) onNavigate(currentIndex - 1)
          break
        case 'ArrowRight':
          if (currentIndex < images.length - 1) onNavigate(currentIndex + 1)
          break
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose, onNavigate, currentIndex, images.length])

  // 滚轮缩放
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    setScale(prev => {
      const delta = e.deltaY > 0 ? -0.1 : 0.1
      return Math.min(5.0, Math.max(0.1, prev + delta))
    })
  }, [])

  // 双击恢复原始大小
  const handleDoubleClick = useCallback(() => {
    setScale(1)
    setTranslate({ x: 0, y: 0 })
  }, [])

  // 拖拽开始
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    setIsDragging(true)
    dragStart.current = { x: e.clientX, y: e.clientY }
    translateStart.current = { ...translate }
  }, [translate])

  // 拖拽移动
  useEffect(() => {
    if (!isDragging) return

    const handleMouseMove = (e: MouseEvent) => {
      setTranslate({
        x: translateStart.current.x + (e.clientX - dragStart.current.x),
        y: translateStart.current.y + (e.clientY - dragStart.current.y)
      })
    }

    const handleMouseUp = () => {
      setIsDragging(false)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging])

  // 点击遮罩关闭
  const handleOverlayClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose()
    }
  }, [onClose])

  // 提取文件名
  const filename = src.split('/').pop() || src

  return (
    <div className="lightbox-overlay" onClick={handleOverlayClick}>
      <button className="lightbox-close" onClick={onClose} title="关闭 (Esc)">✕</button>

      {/* 左箭头 */}
      {images.length > 1 && currentIndex > 0 && (
        <button
          className="lightbox-nav prev"
          onClick={() => onNavigate(currentIndex - 1)}
          title="上一张 (←)"
        >
          ◀
        </button>
      )}

      {/* 图片容器 */}
      <div
        className="lightbox-image-container"
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onDoubleClick={handleDoubleClick}
      >
        <img
          src={src}
          alt={alt}
          style={{
            transform: `translate(${translate.x}px, ${translate.y}px) scale(${scale})`,
          }}
          draggable={false}
        />
      </div>

      {/* 右箭头 */}
      {images.length > 1 && currentIndex < images.length - 1 && (
        <button
          className="lightbox-nav next"
          onClick={() => onNavigate(currentIndex + 1)}
          title="下一张 (→)"
        >
          ▶
        </button>
      )}

      {/* 底部信息 */}
      <div className="lightbox-info">
        <span className="lightbox-filename">{alt || filename}</span>
        {images.length > 1 && (
          <span className="lightbox-counter">{currentIndex + 1}/{images.length}</span>
        )}
        <span className="lightbox-zoom">{Math.round(scale * 100)}%</span>
      </div>
    </div>
  )
}
