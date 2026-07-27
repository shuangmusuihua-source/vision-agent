import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'

const rendererHtml = readFileSync(resolve('src/renderer/index.html'), 'utf8')
const entitlements = readFileSync(resolve('build/entitlements.mac.plist'), 'utf8')

describe('release security policy', () => {
  it('permits WebAssembly without enabling general dynamic code evaluation', () => {
    expect(rendererHtml).toContain("script-src 'self' 'wasm-unsafe-eval'")
    expect(rendererHtml).not.toContain("'unsafe-eval'")
  })

  it('keeps inline styles until renderer style attributes are removed', () => {
    expect(rendererHtml).toContain("style-src 'self' 'unsafe-inline'")
  })

  it('keeps the Electron hardened-runtime entitlements used by arm64 builds', () => {
    expect(entitlements).toContain('com.apple.security.cs.allow-jit')
    expect(entitlements).toContain('com.apple.security.cs.allow-unsigned-executable-memory')
    expect(entitlements).toContain('com.apple.security.cs.disable-library-validation')
  })

  it('does not grant unused DYLD or inbound-network entitlements', () => {
    expect(entitlements).not.toContain('com.apple.security.cs.allow-dyld-environment-variables')
    expect(entitlements).not.toContain('com.apple.security.network.server')
    expect(entitlements).not.toContain('com.apple.security.network.client')
  })
})
