import type { Sql } from './pool.js'
import type { Logger } from '../log.js'

export type AgentStatus = 'idle' | 'working' | 'offline'

export interface AgentStateUpdate {
  agent: string
  status: AgentStatus
  currentTask?: string | null
  progressHtml?: string | null
}

export async function upsertAgentState(sql: Sql, log: Logger, u: AgentStateUpdate): Promise<void> {
  try {
    await sql`
      INSERT INTO agent_state (agent, status, last_seen, current_task, progress_html, updated_at)
      VALUES (
        ${u.agent}, ${u.status}, now(),
        ${u.currentTask ?? null}, ${u.progressHtml ?? null}, now()
      )
      ON CONFLICT (agent) DO UPDATE SET
        status        = EXCLUDED.status,
        last_seen     = EXCLUDED.last_seen,
        current_task  = COALESCE(EXCLUDED.current_task, agent_state.current_task),
        progress_html = COALESCE(EXCLUDED.progress_html, agent_state.progress_html),
        updated_at    = EXCLUDED.updated_at
    `
  } catch (err) {
    log.warn('agent_state upsert failed', { error: String(err), agent: u.agent, status: u.status })
  }
}
