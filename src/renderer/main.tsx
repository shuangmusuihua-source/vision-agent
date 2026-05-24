window.onerror = (msg, source, lineno, colno, error) => {
  console.error('[Renderer Error]', msg, source, lineno, colno, error)
  const el = document.getElementById('error-overlay')
  if (el) {
    el.textContent = `${msg}\n${source}:${lineno}:${colno}\n${error?.stack || ''}`
  } else {
    const div = document.createElement('div')
    div.id = 'error-overlay'
    div.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#1e1e1e;color:#f48771;padding:24px;font-family:monospace;font-size:13px;white-space:pre-wrap;overflow:auto;'
    div.textContent = `${msg}\n${source}:${lineno}:${colno}\n${error?.stack || ''}`
    document.body.appendChild(div)
  }
}

window.addEventListener('unhandledrejection', (e) => {
  console.error('[Renderer Promise Error]', e.reason)
  const el = document.getElementById('error-overlay')
  if (el) {
    el.textContent += `\n\nPromise: ${e.reason?.stack || e.reason}`
  } else {
    const div = document.createElement('div')
    div.id = 'error-overlay'
    div.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#1e1e1e;color:#f48771;padding:24px;font-family:monospace;font-size:13px;white-space:pre-wrap;overflow:auto;'
    div.textContent = `Promise: ${e.reason?.stack || e.reason}`
    document.body.appendChild(div)
  }
})

import React from 'react'
import ReactDOM from 'react-dom/client'
import * as Sentry from '@sentry/electron/renderer'
import App from './App'

Sentry.init()
import './styles/global.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
