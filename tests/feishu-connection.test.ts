import { describe, expect, it } from 'vitest'
import {
  buildFeishuCapabilityAuthorizationArgs,
  buildFeishuScopeCheckArgs,
  buildFeishuScopeAuthorizationArgs,
  isTrustedFeishuAuthorizationUrl,
  parseFeishuAuthIdentity,
  parseFeishuScopeCheckResult,
} from '../src/main/feishu-connection'
import {
  FEISHU_CAPABILITIES,
  getGrantedFeishuCapabilityScopes,
  type FeishuCapabilityId,
} from '../src/shared/feishu-types'

describe('parseFeishuAuthIdentity', () => {
  it('reads the documented user identity status payload', () => {
    expect(parseFeishuAuthIdentity({
      identity: 'user',
      verified: true,
      identities: {
        user: {
          status: 'ready',
          tokenStatus: 'valid',
          userName: 'Sumi User',
          openId: 'ou_example',
          scope: 'offline_access calendar:calendar.event:read',
        },
        bot: { status: 'available' },
      },
    })).toEqual({
      displayName: 'Sumi User',
      openId: 'ou_example',
      userAvailable: true,
      botAvailable: true,
      userScopes: ['offline_access', 'calendar:calendar.event:read'],
    })
  })

  it('accepts a bot-only identity without claiming user authorization', () => {
    expect(parseFeishuAuthIdentity({
      identity: 'bot',
      verified: true,
      identities: {
        user: { status: 'missing' },
        bot: { status: 'ready', available: true, verified: true, appName: 'CLI bot' },
      },
    })).toEqual({
      displayName: 'CLI bot',
      openId: undefined,
      userAvailable: false,
      botAvailable: true,
      userScopes: undefined,
    })
  })

  it('returns null for a configured but unauthorized app', () => {
    expect(parseFeishuAuthIdentity({
      verified: false,
      identities: {
        user: { status: 'missing', tokenStatus: 'missing' },
        bot: { status: 'missing' },
      },
    })).toBeNull()
  })
})

describe('Feishu capability authorization', () => {
  it('builds one domain-scoped login for a product capability', () => {
    expect(buildFeishuCapabilityAuthorizationArgs('calendar')).toEqual([
      'auth',
      'login',
      '--domain',
      'calendar',
      '--json',
    ])
    expect(buildFeishuCapabilityAuthorizationArgs('meeting')).toEqual([
      'auth',
      'login',
      '--domain',
      'vc,minutes,note',
      '--json',
    ])
  })

  it('rejects unknown capability IDs instead of widening authorization', () => {
    expect(buildFeishuCapabilityAuthorizationArgs('all' as FeishuCapabilityId)).toBeNull()
  })

  it('builds exact-scope authorization without widening to a domain', () => {
    expect(buildFeishuScopeAuthorizationArgs([
      'calendar:calendar.event:read',
      'calendar:calendar:readonly',
      'calendar:calendar.event:read',
    ])).toEqual([
      'auth',
      'login',
      '--scope',
      'calendar:calendar.event:read calendar:calendar:readonly',
      '--json',
    ])
    expect(buildFeishuScopeAuthorizationArgs(['unknown:everything'])).toBeNull()
    expect(buildFeishuScopeCheckArgs([
      'calendar:calendar.event:read',
      'calendar:calendar:readonly',
    ])).toEqual([
      'auth',
      'check',
      '--scope',
      'calendar:calendar.event:read calendar:calendar:readonly',
      '--json',
    ])
  })

  it('uses auth check output as the exact scope authority', () => {
    expect(parseFeishuScopeCheckResult({
      ok: false,
      granted: ['calendar:calendar:readonly'],
      missing: ['calendar:calendar.event:read'],
    })).toEqual({
      success: true,
      grantedScopes: ['calendar:calendar:readonly'],
      missingScopes: ['calendar:calendar.event:read'],
    })
    expect(parseFeishuScopeCheckResult({
      ok: true,
      granted: ['attendance:task:readonly'],
      missing: null,
    })).toEqual({
      success: true,
      grantedScopes: ['attendance:task:readonly'],
      missingScopes: [],
    })
    expect(parseFeishuScopeCheckResult({ scope: ['attendance:task:readonly'] })).toBeNull()
    expect(parseFeishuScopeCheckResult({
      ok: false,
      error: { message: 'keychain unavailable' },
    })).toBeNull()
  })

  it('opens only official Feishu HTTPS authorization hosts', () => {
    expect(isTrustedFeishuAuthorizationUrl(
      'https://accounts.feishu.cn/oauth/v1/device/verify?user_code=ABCD',
    )).toBe(true)
    expect(isTrustedFeishuAuthorizationUrl('http://accounts.feishu.cn/oauth')).toBe(false)
    expect(isTrustedFeishuAuthorizationUrl('https://accounts.feishu.cn.example.com/oauth')).toBe(false)
    expect(isTrustedFeishuAuthorizationUrl('https://example.com/oauth')).toBe(false)
  })

  it('summarizes only scopes belonging to the selected domain', () => {
    const calendar = FEISHU_CAPABILITIES.find(capability => capability.id === 'calendar')!
    const docs = FEISHU_CAPABILITIES.find(capability => capability.id === 'docs')!
    const scopes = [
      'offline_access',
      'calendar:calendar.event:read',
      'calendar:calendar.event:write',
      'docx:document:readonly',
    ]

    expect(getGrantedFeishuCapabilityScopes(calendar, scopes)).toEqual([
      'calendar:calendar.event:read',
      'calendar:calendar.event:write',
    ])
    expect(getGrantedFeishuCapabilityScopes(docs, scopes)).toEqual([
      'docx:document:readonly',
    ])
  })
})
