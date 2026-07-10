import { describe, expect, it } from 'vitest'
import {
  MAX_CRON_LINKED_URLS,
  normalizeCronLinkedUrls,
  sanitizeCronLinkedUrls,
} from '../src/shared/cron-linked-urls'

describe('cron linked urls', () => {
  it('normalizes schemes, removes blanks, and deduplicates urls', () => {
    expect(normalizeCronLinkedUrls([
      'example.com/report',
      '  ',
      'https://example.com/report',
      'http://news.example.com/feed',
    ])).toEqual([
      'https://example.com/report',
      'http://news.example.com/feed',
    ])
  })

  it('rejects unsupported protocols and more than three urls', () => {
    expect(() => normalizeCronLinkedUrls(['file:///tmp/report'])).toThrow('仅支持 http 或 https')
    expect(() => normalizeCronLinkedUrls(Array.from({ length: MAX_CRON_LINKED_URLS + 1 }, (_, index) => `https://example.com/${index}`)))
      .toThrow('最多只能关联 3 个网址')
  })

  it('sanitizes malformed persisted values without blocking startup', () => {
    expect(sanitizeCronLinkedUrls([
      'https://valid.example.com',
      'file:///tmp/private',
      42,
      'valid.example.com',
      'https://fourth.example.com',
    ])).toEqual([
      'https://valid.example.com/',
      'https://fourth.example.com/',
    ])
  })
})
