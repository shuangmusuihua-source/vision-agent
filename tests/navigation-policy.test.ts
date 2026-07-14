import { describe, expect, it } from 'vitest'
import { isAllowedExternalUrl, isAllowedRendererNavigation } from '../src/main/navigation-policy'

describe('navigation policy', () => {
  it('opens only HTTP(S) URLs externally', () => {
    expect(isAllowedExternalUrl('https://example.com/docs')).toBe(true)
    expect(isAllowedExternalUrl('http://localhost:3000')).toBe(true)
    expect(isAllowedExternalUrl('file:///tmp/report.html')).toBe(false)
    expect(isAllowedExternalUrl('javascript:alert(1)')).toBe(false)
    expect(isAllowedExternalUrl('data:text/html,test')).toBe(false)
    expect(isAllowedExternalUrl('not a url')).toBe(false)
  })

  it('keeps packaged navigation on the exact renderer entry file', () => {
    const entry = 'file:///Applications/sumi.app/renderer/index.html'
    expect(isAllowedRendererNavigation(`${entry}#settings`, entry)).toBe(true)
    expect(isAllowedRendererNavigation('file:///tmp/other.html', entry)).toBe(false)
    expect(isAllowedRendererNavigation('file://remote-host/Applications/sumi.app/renderer/index.html', entry)).toBe(false)
    expect(isAllowedRendererNavigation('https://example.com', entry)).toBe(false)
  })

  it('allows only the configured development origin', () => {
    const entry = 'http://127.0.0.1:5173/'
    expect(isAllowedRendererNavigation('http://127.0.0.1:5173/settings', entry)).toBe(true)
    expect(isAllowedRendererNavigation('http://localhost:5173/', entry)).toBe(false)
    expect(isAllowedRendererNavigation('https://127.0.0.1:5173/', entry)).toBe(false)
  })
})
