export interface AllowedSet { user_ids: number[]; chat_ids: number[] }
export interface MessageMeta { from_id: number; chat_id: number }

export type GateResult = 'allow' | 'user_not_allowed' | 'chat_not_allowed'

export function allowMessage(m: MessageMeta, a: AllowedSet): GateResult {
  if (!a.user_ids.includes(m.from_id)) return 'user_not_allowed'
  if (!a.chat_ids.includes(m.chat_id)) return 'chat_not_allowed'
  return 'allow'
}
