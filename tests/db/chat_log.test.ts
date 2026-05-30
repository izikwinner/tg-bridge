import { describe, test, expect } from 'bun:test'
import { insertChatLog } from '../../src/db/chat_log'
import type { Sql } from '../../src/db/pool'
import type { Logger } from '../../src/log'

function makeLogger(): { log: Logger; calls: Array<{ level: string; msg: string; meta?: unknown }> } {
  const calls: Array<{ level: string; msg: string; meta?: unknown }> = []
  const log: Logger = {
    info: (msg, meta) => { calls.push({ level: 'info', msg, meta }) },
    warn: (msg, meta) => { calls.push({ level: 'warn', msg, meta }) },
    error: (msg, meta) => { calls.push({ level: 'error', msg, meta }) },
  } as Logger
  return { log, calls }
}

function makeMockSql(behaviour: 'ok' | 'throw'): {
  sql: Sql
  calls: Array<{ strings: ReadonlyArray<string>; values: unknown[] }>
} {
  const calls: Array<{ strings: ReadonlyArray<string>; values: unknown[] }> = []
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ strings: [...strings], values })
    if (behaviour === 'throw') return Promise.reject(new Error('db down'))
    return Promise.resolve([{ id: 1 }])
  }
  ;(tag as unknown as { json: (v: unknown) => unknown }).json = (v: unknown) => ({ json: v })
  return { sql: tag as unknown as Sql, calls }
}

describe('insertChatLog', () => {
  test('builds expected tagged template values', async () => {
    const { log } = makeLogger()
    const { sql, calls } = makeMockSql('ok')
    await insertChatLog(sql, log, {
      agent: 'alpha',
      channel: 'web',
      direction: 'in',
      text: 'hello',
      meta: { web_session_id: 'abc' },
    })
    expect(calls).toHaveLength(1)
    const c = calls[0]!
    expect(c.values[0]).toBe('alpha')
    expect(c.values[1]).toBe('web')
    expect(c.values[2]).toBe('in')
    expect(c.values[3]).toBe('hello')
    expect(c.values[4]).toBe(JSON.stringify({ web_session_id: 'abc' }))
  })

  test('swallows db errors and warns', async () => {
    const { log, calls: logCalls } = makeLogger()
    const { sql } = makeMockSql('throw')
    await insertChatLog(sql, log, { agent: 'a', channel: 'telegram', direction: 'out', text: 'x' })
    const warn = logCalls.find((c) => c.level === 'warn')
    expect(warn?.msg).toBe('chat_log insert failed')
  })

  test('defaults meta to empty json object', async () => {
    const { log } = makeLogger()
    const { sql, calls } = makeMockSql('ok')
    await insertChatLog(sql, log, { agent: 'a', channel: 'telegram', direction: 'in', text: 't' })
    expect(calls[0]!.values[4]).toBe('{}')
  })
})
