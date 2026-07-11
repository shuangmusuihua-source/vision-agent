import React from 'react'
import ReactDOM from 'react-dom/client'
import * as Sentry from '@sentry/electron/renderer'
import App from './App'
import { getGlobalErrorMessage, isExpectedCancellation } from './lib/global-errors'
import { useUiStore } from './store/ui-slice'

window.addEventListener('error', (event) => {
  console.error(
    '[Renderer Error]',
    event.message,
    event.filename,
    event.lineno,
    event.colno,
    event.error,
  )
  useUiStore.getState().setMainError(
    `界面运行错误：${getGlobalErrorMessage(event.error || event.message)}`,
  )
})

window.addEventListener('unhandledrejection', (event) => {
  console.error('[Renderer Promise Error]', event.reason)
  if (isExpectedCancellation(event.reason)) return

  useUiStore.getState().setMainError(
    `后台操作失败：${getGlobalErrorMessage(event.reason)}`,
  )
})

Sentry.init()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
