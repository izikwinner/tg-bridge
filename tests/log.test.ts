import { describe, test, expect, mock } from 'bun:test'
import { createLogger } from '../src/log'

describe('log', () => {
  test('redacts secrets from message', () => {
    const writes: string[] = []
    const log = createLogger({
      secrets: ['SECRET123'],
      sink: (line) => writes.push(line),
    })
    log.info('connect with token=SECRET123')
    expect(writes[0]).toContain('[REDACTED]')
    expect(writes[0]).not.toContain('SECRET123')
  })

  test('redacts secrets from structured fields', () => {
    const writes: string[] = []
    const log = createLogger({
      secrets: ['BOT_TOKEN_XYZ'],
      sink: (line) => writes.push(line),
    })
    log.info('event', { url: 'https://api/bot/BOT_TOKEN_XYZ/getMe' })
    expect(writes[0]).not.toContain('BOT_TOKEN_XYZ')
    expect(writes[0]).toContain('[REDACTED]')
  })

  test('passes through clean messages', () => {
    const writes: string[] = []
    const log = createLogger({ secrets: [], sink: (line) => writes.push(line) })
    log.info('hello')
    expect(writes[0]).toContain('hello')
  })
})
