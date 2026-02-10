import { create } from 'zustand'
import type { FileInfo } from '../components'

interface FileState {
  folderPath: string | null
  files: FileInfo[]
  isLoading: boolean
  selectedPaths: Set<string>
}

interface FileActions {
  setFolderPath: (path: string | null) => void
  setFiles: (files: FileInfo[]) => void
  setIsLoading: (loading: boolean) => void
  setSelectedPaths: (paths: Set<string>) => void
  toggleSelection: (path: string) => void
  clearSelection: () => void
}

type FileStore = FileState & FileActions

export const useFileStore = create<FileStore>((set, get) => ({
  folderPath: null,
  files: [],
  isLoading: false,
  selectedPaths: new Set(),

  setFolderPath: (path) => set({ folderPath: path }),
  setFiles: (files) => set({ files }),
  setIsLoading: (loading) => set({ isLoading: loading }),
  setSelectedPaths: (paths) => set({ selectedPaths: paths }),

  toggleSelection: (path) => {
    const current = new Set(get().selectedPaths)
    if (current.has(path)) {
      current.delete(path)
    } else {
      current.add(path)
    }
    set({ selectedPaths: current })
  },

  clearSelection: () => set({ selectedPaths: new Set() })
}))
