import { useEffect, useRef } from 'react'
import { useLayoutStore } from '../stores'

/**
 * 全窗口拖拽支持 hook
 * 处理文件/文件夹拖拽到窗口的视觉反馈和文件打开
 */
export function useDragDrop(): void {
  const { setIsDragOver } = useLayoutStore()
  const dragCounterRef = useRef(0)

  useEffect(() => {
    const handleDragEnter = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return
      e.preventDefault()
      e.stopPropagation()
      dragCounterRef.current++
      setIsDragOver(true)
    }

    const handleDragLeave = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return
      e.preventDefault()
      e.stopPropagation()
      dragCounterRef.current--
      if (dragCounterRef.current === 0) {
        setIsDragOver(false)
      }
    }

    // 仅处理「从操作系统拖入外部文件」；应用内文件树拖放（自定义 MIME）放行，
    // 否则 document 级的无条件 preventDefault/stopPropagation 会打乱内部 DnD。
    const isExternalFileDrag = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files')

    const handleDragOver = (e: DragEvent) => {
      if (!isExternalFileDrag(e)) return
      e.preventDefault()
      e.stopPropagation()
    }

    const handleDrop = async (e: DragEvent) => {
      if (!isExternalFileDrag(e)) return
      e.preventDefault()
      e.stopPropagation()
      dragCounterRef.current = 0
      setIsDragOver(false)

      const files = e.dataTransfer?.files
      if (!files || files.length === 0) return

      const paths: string[] = []
      for (let i = 0; i < files.length; i++) {
        const filePath = window.api.getPathForFile(files[i])
        if (filePath) paths.push(filePath)
      }

      await window.api.openDroppedPaths(paths)
    }

    document.addEventListener('dragenter', handleDragEnter)
    document.addEventListener('dragleave', handleDragLeave)
    document.addEventListener('dragover', handleDragOver)
    document.addEventListener('drop', handleDrop)

    return () => {
      document.removeEventListener('dragenter', handleDragEnter)
      document.removeEventListener('dragleave', handleDragLeave)
      document.removeEventListener('dragover', handleDragOver)
      document.removeEventListener('drop', handleDrop)
    }
  }, [])
}
