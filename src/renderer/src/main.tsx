import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './components'
import './assets/main.css'
import './assets/markdown.css'
import './assets/prism-theme.css'
import 'katex/dist/katex.min.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  // 🚨 临时禁用 StrictMode 以调试性能问题
  // <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  // </React.StrictMode>
)
