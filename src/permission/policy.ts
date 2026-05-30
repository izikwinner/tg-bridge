export interface Policy {
  relay_patterns: string[]
  default: 'allow' | 'deny'
}

export interface ToolInvocation {
  tool: string
  args: Record<string, unknown>
}

function matches(pat: string, inv: ToolInvocation): boolean {
  const m = pat.match(/^([A-Za-z]+)\((.*)\)$/)
  if (!m) return false
  const [, tool, body] = m
  if (tool !== inv.tool) return false
  const cmd = typeof inv.args['command'] === 'string' ? (inv.args['command'] as string) : ''
  const prefix = (body ?? '').replace(/\*$/, '').trim()
  return cmd.startsWith(prefix)
}

export function needsRelay(inv: ToolInvocation, policy: Policy): boolean {
  return policy.relay_patterns.some(p => matches(p, inv))
}
