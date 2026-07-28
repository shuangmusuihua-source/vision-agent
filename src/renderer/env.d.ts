/// <reference types="vite/client" />

import type { WindowApi } from '../shared/preload-api'

declare global {
  interface Window {
    api: WindowApi
  }

  namespace React {
    interface KeyboardEvent<T = Element> {
      isComposing?: boolean
    }
  }
}

declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}
