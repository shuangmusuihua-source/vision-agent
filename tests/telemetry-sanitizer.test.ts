import { describe, expect, it } from 'vitest'
import { sanitizeTelemetryEvent } from '../src/shared/telemetry-sanitizer'

describe('sanitizeTelemetryEvent', () => {
  it('redacts secret-bearing keys recursively', () => {
    const event = {
      extra: {
        ANTHROPIC_API_KEY: 'custom-secret',
        headers: {
          'x-api-key': 'header-secret',
          authorization: 'Bearer credential',
        },
      },
    }

    expect(sanitizeTelemetryEvent(event)).toEqual({
      extra: {
        ANTHROPIC_API_KEY: '[Filtered]',
        headers: {
          'x-api-key': '[Filtered]',
          authorization: '[Filtered]',
        },
      },
    })
  })

  it('redacts configured secrets and common token patterns inside messages', () => {
    const event = {
      message: [
        'configured arbitrary-provider-key',
        'sk-ant-api03-abcdefghijklmnop',
        'Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature',
      ].join(' | '),
    }

    const sanitized = sanitizeTelemetryEvent(event, {
      secretValues: ['arbitrary-provider-key'],
    })

    expect(sanitized.message).not.toContain('arbitrary-provider-key')
    expect(sanitized.message).not.toContain('sk-ant-api03')
    expect(sanitized.message).not.toContain('eyJhbGci')
    expect(sanitized.message.match(/\[Filtered]/g)).toHaveLength(3)
  })

  it('redacts URL credentials and secret query parameters', () => {
    const event = {
      request: {
        url: 'https://user:password@example.com/v1?api_key=secret-value&mode=test',
      },
    }

    expect(sanitizeTelemetryEvent(event).request.url).toBe(
      'https://[Filtered]@example.com/v1?api_key=[Filtered]&mode=test',
    )
  })

  it('redacts session identifiers while preserving unrelated identifiers', () => {
    const event = {
      sessionId: 'app-session-1',
      nested: { sdk_session_id: 'sdk-session-1', requestId: 'request-1' },
    }

    expect(sanitizeTelemetryEvent(event)).toEqual({
      sessionId: '[Filtered Session]',
      nested: {
        sdk_session_id: '[Filtered Session]',
        requestId: 'request-1',
      },
    })
  })

  it('replaces workspace and home prefixes without hiding useful file suffixes', () => {
    const event = {
      message: 'Failed /Users/person/Desktop/private-workspace/docs/report.md',
      filename: '/Users/person/Library/Application Support/sumi/log.txt',
    }

    expect(sanitizeTelemetryEvent(event, {
      privatePathPrefixes: ['/Users/person/Desktop/private-workspace'],
      homeDirectory: '/Users/person',
    })).toEqual({
      message: 'Failed [PrivatePath]/docs/report.md',
      filename: '[Home]/Library/Application Support/sumi/log.txt',
    })
  })

  it('keeps innocuous apiKey wording instead of dropping the event', () => {
    const event = { message: 'apiKey configuration missing', level: 'warning' }

    expect(sanitizeTelemetryEvent(event)).toEqual(event)
  })

  it('does not mutate the original event', () => {
    const event = { extra: { password: 'secret' } }

    const sanitized = sanitizeTelemetryEvent(event)

    expect(sanitized).not.toBe(event)
    expect(sanitized.extra).not.toBe(event.extra)
    expect(event.extra.password).toBe('secret')
  })
})
