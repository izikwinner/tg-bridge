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

export interface Todo {
  content?: string
  subject?: string
  title?: string
  status?: 'pending' | 'in_progress' | 'completed' | string
}

export interface ProgressTrackerOpts {
  now?: () => number
  startMs?: number
}

const TODO_MAX = 60
const BAR_WIDTH = 10

function todoText(t: Todo): string {
  const raw = t.content ?? t.subject ?? t.title ?? ''
  return raw.length > TODO_MAX ? raw.slice(0, TODO_MAX) : raw
}

function progressBar(done: number, total: number): string {
  if (total <= 0) return ''
  const pct = Math.min(100, Math.floor((done * 100) / total))
  const filled = Math.floor((BAR_WIDTH * done) / total)
  return '▰'.repeat(filled) + '▱'.repeat(BAR_WIDTH - filled) + ` ${pct}%`
}

export class ProgressTracker {
  private toolCalls: ToolCall[] = []
  private todos: Todo[] = []
  private readonly startMs: number
  private readonly now: () => number

  constructor(opts: ProgressTrackerOpts = {}) {
    this.now = opts.now ?? (() => Date.now())
    this.startMs = opts.startMs ?? this.now()
  }

  onTool(name: string, input: Record<string, unknown>): void {
    if (name === 'TodoWrite') {
      const raw = input['todos']
      if (Array.isArray(raw)) this.onTodoWrite(raw as Todo[])
      return
    }
    const tag = TOOL_TAGS[name] ?? DEFAULT_TAG
    const detail = summarizeToolInput(name, input)
    this.toolCalls.push({ tag, name, detail })
    if (this.toolCalls.length > KEEP) this.toolCalls.shift()
  }

  onTodoWrite(todos: Todo[]): void {
    this.todos = todos
  }

  elapsedSec(): number {
    return Math.max(0, Math.floor((this.now() - this.startMs) / 1000))
  }

  private renderPlan(): string[] {
    if (this.todos.length === 0) return []
    const completed = this.todos.filter((t) => t.status === 'completed')
    const inProgress = this.todos.filter((t) => t.status === 'in_progress')
    const pending = this.todos.filter((t) => t.status === 'pending')
    const done = completed.length
    const total = this.todos.length
    const lines: string[] = ['plan:']
    if (done > 1) lines.push(`  ... +${done - 1} done`)
    const lastCompleted = completed[completed.length - 1]
    if (lastCompleted) lines.push(`  x ${todoText(lastCompleted)}`)
    for (const t of inProgress) lines.push(`  > ${todoText(t)}`)
    const pendingHead = pending.slice(0, 2)
    for (const t of pendingHead) lines.push(`    ${todoText(t)}`)
    if (pending.length > 2) lines.push(`    ... +${pending.length - 2} more`)
    lines.push(progressBar(done, total))
    return lines
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
    const plan = this.renderPlan()
    if (plan.length > 0) {
      lines.push('')
      lines.push(...plan)
    }
    return `<pre>${escapeHtml(lines.join('\n'))}</pre>`
  }
}
