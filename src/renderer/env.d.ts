/// <reference types="vite/client" />

declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}

declare namespace React {
  interface KeyboardEvent<T = Element> {
    isComposing?: boolean
  }
}
