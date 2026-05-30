import postgres from 'postgres'
import { readFileSync, existsSync } from 'fs'
import type { Logger } from '../log.js'

export type Sql = ReturnType<typeof postgres>

export interface DbOpts {
  dsn: string
  agent: string
  logger: Logger
}

let cached: Sql | null = null

export function getSql(opts: DbOpts): Sql {
  if (cached) return cached
  cached = postgres(opts.dsn, {
    max: 4,
    idle_timeout: 30,
    connect_timeout: 5,
    connection: { application_name: `tg-bridge:${opts.agent}` },
    onnotice: () => {},
  })
  return cached
}

export function closeSql(): Promise<void> {
  if (!cached) return Promise.resolve()
  const c = cached
  cached = null
  return c.end({ timeout: 2 }).catch(() => {})
}

export function loadDsn(file: string): string | null {
  if (!existsSync(file)) return null
  const dsn = readFileSync(file, 'utf8').trim()
  if (!dsn || dsn.includes('REPLACE_ME')) return null
  return dsn
}
