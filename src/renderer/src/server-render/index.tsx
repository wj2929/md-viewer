import React from 'react'
import ReactDOM from 'react-dom/client'
import { ServerRenderApp } from './ServerRenderApp'

const root = document.getElementById('root')

if (!root) {
  throw new Error('Missing root element for server render')
}

ReactDOM.createRoot(root).render(
  <ServerRenderApp />
)
