import type { Sql } from './pool.js'
import type { Logger } from '../log.js'

export type ChatChannel = 'telegram' | 'web' | 'swarm'
export type ChatDirection = 'in' | 'out'

export interface ChatLogRow {
  agent: string
  channel: ChatChannel
  direction: ChatDirection
  text: string
  meta?: Record<string, unknown>
}

export async function insertChatLog(sql: Sql, log: Logger, row: ChatLogRow): Promise<void> {
  const metaJson = JSON.stringify(row.meta ?? {})
  try {
    await sql`
      INSERT INTO chat_log (agent, channel, direction, text, meta)
      VALUES (${row.agent}, ${row.channel}, ${row.direction}, ${row.text}, ${metaJson}::jsonb)
    `
  } catch (err) {
    log.warn('chat_log insert failed', {
      error: String(err),
      agent: row.agent,
      channel: row.channel,
      direction: row.direction,
    })
  }
}
