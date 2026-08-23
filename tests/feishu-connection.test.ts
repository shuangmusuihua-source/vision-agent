import { describe, expect, it } from 'vitest'
import { parseFeishuAuthIdentity } from '../src/main/feishu-connection'

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
