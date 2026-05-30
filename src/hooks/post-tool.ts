const MAX_ARG = 80

function firstLine(s: string): string {
  const i = s.indexOf('\n')
  return i === -1 ? s : s.slice(0, i)
}

function truncate(s: string): string {
  return s.length > MAX_ARG ? s.slice(0, MAX_ARG - 1) + '…' : s
}

function asString(v: unknown): string {
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (v == null) return ''
  return JSON.stringify(v)
}

export interface PostToolInput {
  tool_name?: string
  tool_input?: Record<string, unknown>
  tool?: string
  args?: Record<string, unknown>
}

export function formatPostTool(input: PostToolInput): string | null {
  const tool = input.tool_name ?? input.tool ?? ''
  if (!tool) return null
  const args = input.tool_input ?? input.args ?? {}
  let arg = ''
  switch (tool) {
    case 'Bash':
      arg = asString(args['command'])
      break
    case 'Read':
    case 'Edit':
    case 'Write':
    case 'NotebookEdit':
      arg = asString(args['file_path'] ?? args['notebook_path'])
      break
    case 'Grep':
    case 'Glob':
      arg = asString(args['pattern'])
      break
    case 'Task':
      arg = asString(args['description'] ?? args['subagent_type'])
      break
    case 'WebFetch':
      arg = asString(args['url'])
      break
    case 'WebSearch':
      arg = asString(args['query'])
      break
    default: {
      const firstVal = Object.values(args)[0]
      arg = asString(firstVal)
    }
  }
  arg = truncate(firstLine(arg))
  return arg.length > 0 ? `→ ${tool}: \`${arg}\`` : `→ ${tool}`
}
