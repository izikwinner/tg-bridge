import { describe, test, expect } from 'bun:test'
import { maskSecrets } from '../../src/progress/mask'

describe('maskSecrets', () => {
  test('IPv4 masked except first+last octet', () => {
    expect(maskSecrets('curl 192.168.1.42/api')).toBe('curl 192.***.***.42/api')
  })

  test('multiple IPs', () => {
    expect(maskSecrets('10.0.0.1 -> 172.16.5.8')).toBe('10.***.***.1 -> 172.***.***.8')
  })

  test('secret path masked (under a config dir)', () => {
    expect(maskSecrets('cat ~/.config/secrets/api-key')).toBe('cat ~/.config/secrets/***')
  })

  test('bot token masked', () => {
    expect(maskSecrets('TOKEN=1234567890:AAxxBlahBlahBlah'))
      .toBe('TOKEN=123***:AAxx***')
  })

  test('supabase URL masked', () => {
    expect(maskSecrets('https://abcdefghij.supabase.co/rest/v1'))
      .toBe('https://abcd*****ghij.supabase.co/rest/v1')
  })

  test('long alphanum token masked', () => {
    expect(maskSecrets('Authorization: Bearer sk_live_abcdef1234567890abcdefxyz'))
      .toMatch(/Bearer sk_l\*\*\*[a-zA-Z0-9_]{4}/)
  })

  test('short strings untouched', () => {
    expect(maskSecrets('ls /tmp')).toBe('ls /tmp')
    expect(maskSecrets('foo bar baz')).toBe('foo bar baz')
  })

  test('empty input returns empty', () => {
    expect(maskSecrets('')).toBe('')
  })
})
