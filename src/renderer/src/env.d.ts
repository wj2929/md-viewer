/// <reference types="vite/client" />
/// <reference types="react" />
/// <reference types="react-dom" />
/// <reference path="../../preload/index.d.ts" />

// TypeScript 5.x + React 18/19 需要全局 JSX 命名空间
import type { JSX as ReactJSX } from 'react'
declare global {
  namespace JSX {
    interface Element extends ReactJSX.Element {}
    interface IntrinsicElements extends ReactJSX.IntrinsicElements {}
  }
}