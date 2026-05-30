const TOOL_TAGS: Record<string, string> = {
  Read: '[R]',
  Write: '[W]',
  Edit: '[W]',
  MultiEdit: '[W]',
  NotebookEdit: '[W]',
  Bash: '[B]',
  Grep: '[G]',
  Glob: '[G]',
  WebFetch: '[F]',
  WebSearch: '[S]',
  Task: '[A]',
  TodoWrite: '[T]',
}
const DEFAULT_TAG = '[.]'
const WINDOW = 5
const KEEP = 10
const MAX_DETAIL = 40

function lastTwoPathParts(fp: string): string {
  const norm = fp.replace(/\\/g, '/')
  const parts = norm.split('/').filter(Boolean)
  if (parts.length === 0) return ''
  if (parts.length === 1) return parts[0] ?? ''
  return parts.slice(-2).join('/')
}

function safeHost(url: string): string {
  try {
    return new URL(url).host || url.slice(0, MAX_DETAIL)
  } catch {
    return url.slice(0, MAX_DETAIL)
  }
}

function clip(s: string, max = MAX_DETAIL): string {
  return s.length > max ? s.slice(0, max) : s
}

function firstLine(s: string): string {
  const i = s.indexOf('\n')
  return i === -1 ? s : s.slice(0, i)
}

export function summarizeToolInput(name: string, input: Record<string, unknown>): string {
  const get = (k: string) => {
    const v = input[k]
    return typeof v === 'string' ? v : ''
  }
  switch (name) {
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return clip(lastTwoPathParts(get('file_path') || get('notebook_path') || get('path')))
    case 'Bash':
      return clip(firstLine(get('command')))
    case 'Grep':
    case 'Glob': {
      const p = get('pattern')
      return p ? `"${clip(p, MAX_DETAIL - 2)}"` : ''
    }
    case 'Task':
      return clip(get('subagent_type') || get('description'))
    case 'WebFetch':
      return clip(safeHost(get('url')))
    case 'WebSearch':
      return clip(get('query'))
    case 'TodoWrite':
      return ''
    default: {
      const first = Object.values(input).find((v) => typeof v === 'string') as string | undefined
      return first ? clip(firstLine(first)) : ''
    }
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export interface ToolCall {
  tag: string
  name: string
  detail: string
}

export interface ProgressTrackerOpts {
  now?: () => number
  startMs?: number
}

export class ProgressTracker {
  private toolCalls: ToolCall[] = []
  private readonly startMs: number
  private readonly now: () => number

  constructor(opts: ProgressTrackerOpts = {}) {
    this.now = opts.now ?? (() => Date.now())
    this.startMs = opts.startMs ?? this.now()
  }

  onTool(name: string, input: Record<string, unknown>): void {
    const tag = TOOL_TAGS[name] ?? DEFAULT_TAG
    const detail = summarizeToolInput(name, input)
    this.toolCalls.push({ tag, name, detail })
    if (this.toolCalls.length > KEEP) this.toolCalls.shift()
  }

  elapsedSec(): number {
    return Math.max(0, Math.floor((this.now() - this.startMs) / 1000))
  }

  render(state: 'working' | 'done' = 'working'): string {
    const lines: string[] = [`${state} -- ${this.elapsedSec()}s`]
    if (this.toolCalls.length > 0) {
      lines.push('')
      const total = this.toolCalls.length
      const recent = this.toolCalls.slice(-WINDOW)
      if (total > recent.length) {
        lines.push(`▸ ... +${total - recent.length} earlier`)
      }
      for (const tc of recent) {
        const namePart = tc.name.toLowerCase()
        const detailPart = tc.detail ? ` ${tc.detail}` : ''
        lines.push(`▸ ${tc.tag} ${namePart}${detailPart}`)
      }
    }
    return `<pre>${escapeHtml(lines.join('\n'))}</pre>`
  }
}
