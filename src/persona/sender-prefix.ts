export interface PrefixInput {
  text: string
  user_id: number
  username: string | undefined
  first_name: string | undefined
  owner_ids: number[]
}

export function injectSenderPrefix(i: PrefixInput): string {
  const role = i.owner_ids.includes(i.user_id) ? 'owner' : 'client'
  const parts: string[] = [`id=${i.user_id}`]
  if (i.username) parts.push(`@${i.username}`)
  if (i.first_name) parts.push(`name=${i.first_name}`)
  parts.push(`| role=${role}`)
  return `[sender: ${parts.join(' ')}]\n${i.text}`
}
