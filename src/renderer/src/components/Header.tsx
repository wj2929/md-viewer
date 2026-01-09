/**
 * Header 组件 - 全局导航容器
 * v1.3.6 混合方案
 *
 * 结构：
 * - NavigationBar（第一行）：Logo + 路径 + 搜索 + 设置
 * - TabBar（第二行）：当前打开的文件标签
 * - BookmarkBar（第三行）：收藏的文件书签（可折叠）
 */

import { ReactNode } from 'react'
import './Header.css'

interface HeaderProps {
  children: ReactNode
}

export function Header({ children }: HeaderProps): JSX.Element {
  return (
    <header className="app-header">
      {children}
    </header>
  )
}
