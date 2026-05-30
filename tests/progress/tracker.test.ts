import { describe, test, expect } from 'bun:test'
import { ProgressTracker, summarizeToolInput } from '../../src/progress/tracker'

describe('summarizeToolInput', () => {
  test('Read/Edit/Write → last two path parts', () => {
    expect(summarizeToolInput('Read', { file_path: '/home/Izik/foo/bar.ts' })).toBe('foo/bar.ts')
    expect(summarizeToolInput('Edit', { file_path: 'a.ts' })).toBe('a.ts')
  })

  test('Bash → first line of command, truncated', () => {
    expect(summarizeToolInput('Bash', { command: 'ls -la' })).toBe('ls -la')
    expect(summarizeToolInput('Bash', { command: 'line1\nline2' })).toBe('line1')
    expect(summarizeToolInput('Bash', { command: 'x'.repeat(100) })).toBe('x'.repeat(40))
  })

  test('Grep/Glob → "pattern"', () => {
    expect(summarizeToolInput('Grep', { pattern: 'TODO' })).toBe('"TODO"')
    expect(summarizeToolInput('Glob', { pattern: '*.ts' })).toBe('"*.ts"')
  })

  test('Task → subagent_type', () => {
    expect(summarizeToolInput('Task', { subagent_type: 'researcher' })).toBe('researcher')
    expect(summarizeToolInput('Task', { description: 'fallback' })).toBe('fallback')
  })

  test('WebFetch → host', () => {
    expect(summarizeToolInput('WebFetch', { url: 'https://example.com/foo' })).toBe('example.com')
  })

  test('TodoWrite → empty (rendered separately)', () => {
    expect(summarizeToolInput('TodoWrite', { todos: [] })).toBe('')
  })

  test('unknown tool → first string field, truncated', () => {
    expect(summarizeToolInput('mcp__gbrain__recall', { query: 'foo' })).toBe('foo')
  })
})

describe('ProgressTracker', () => {
  test('initial render shows working + elapsed 0s', () => {
    const t = new ProgressTracker({ now: () => 1000, startMs: 1000 })
    expect(t.render()).toBe('<pre>working -- 0s</pre>')
  })

  test('elapsed counter advances', () => {
    let clock = 1000
    const t = new ProgressTracker({ now: () => clock, startMs: 1000 })
    clock = 1000 + 42_000
    expect(t.render()).toBe('<pre>working -- 42s</pre>')
  })

  test('one tool call rendered with tag', () => {
    const t = new ProgressTracker({ now: () => 1000, startMs: 1000 })
    t.onTool('Bash', { command: 'ls' })
    expect(t.render()).toBe('<pre>working -- 0s\n\n▸ [B] bash ls</pre>')
  })

  test('window collapses older than 5', () => {
    const t = new ProgressTracker({ now: () => 1000, startMs: 1000 })
    for (let i = 1; i <= 7; i++) t.onTool('Bash', { command: `cmd${i}` })
    const out = t.render()
    expect(out).toContain('... +2 earlier')
    expect(out).toContain('cmd3')
    expect(out).toContain('cmd7')
    expect(out).not.toContain('cmd1')
    expect(out).not.toContain('cmd2')
  })

  test('keeps at most 10 internally (drops oldest)', () => {
    const t = new ProgressTracker({ now: () => 1000, startMs: 1000 })
    for (let i = 1; i <= 12; i++) t.onTool('Bash', { command: `cmd${i}` })
    const out = t.render()
    expect(out).toContain('... +5 earlier')
    expect(out).toContain('cmd12')
    expect(out).not.toContain('cmd2')
  })

  test('done state header', () => {
    const t = new ProgressTracker({ now: () => 5000, startMs: 1000 })
    t.onTool('Read', { file_path: 'a.ts' })
    expect(t.render('done')).toContain('done -- 4s')
  })

  test('HTML escapes special chars', () => {
    const t = new ProgressTracker({ now: () => 1000, startMs: 1000 })
    t.onTool('Bash', { command: 'echo "<script>"' })
    const out = t.render()
    expect(out).not.toContain('<script>')
    expect(out).toContain('&lt;script&gt;')
  })

  test('TodoWrite via onTool routes to onTodoWrite (not a tool call)', () => {
    const t = new ProgressTracker({ now: () => 1000, startMs: 1000 })
    t.onTool('TodoWrite', { todos: [
      { content: 'a', status: 'completed' },
      { content: 'b', status: 'in_progress' },
    ] })
    const out = t.render()
    expect(out).toContain('plan:')
    expect(out).toContain('x a')
    expect(out).toContain('&gt; b')
    expect(out).not.toContain('todowrite')
  })

  test('plan: progress bar reflects done/total', () => {
    const t = new ProgressTracker({ now: () => 1000, startMs: 1000 })
    t.onTodoWrite([
      { content: 'a', status: 'completed' },
      { content: 'b', status: 'completed' },
      { content: 'c', status: 'in_progress' },
      { content: 'd', status: 'pending' },
    ])
    const out = t.render()
    expect(out).toContain('50%')
    expect(out).toContain('▰▰▰▰▰▱▱▱▱▱')
    expect(out).toContain('... +1 done')
    expect(out).toContain('x b')
    expect(out).toContain('&gt; c')
    expect(out).toContain('    d')
  })

  test('plan: collapses extra pending into "... +N more"', () => {
    const t = new ProgressTracker({ now: () => 1000, startMs: 1000 })
    t.onTodoWrite([
      { content: 'cur', status: 'in_progress' },
      { content: 'p1', status: 'pending' },
      { content: 'p2', status: 'pending' },
      { content: 'p3', status: 'pending' },
      { content: 'p4', status: 'pending' },
    ])
    const out = t.render()
    expect(out).toContain('    p1')
    expect(out).toContain('    p2')
    expect(out).toContain('... +2 more')
    expect(out).not.toContain('    p3')
  })

  test('plan: subject/title fallback when content missing', () => {
    const t = new ProgressTracker({ now: () => 1000, startMs: 1000 })
    t.onTodoWrite([
      { subject: 'from-subject', status: 'in_progress' },
      { title: 'from-title', status: 'pending' },
    ])
    const out = t.render()
    expect(out).toContain('&gt; from-subject')
    expect(out).toContain('    from-title')
  })

  test('plan: 0% / 100% edges', () => {
    const tracker = new ProgressTracker({ now: () => 1000, startMs: 1000 })
    tracker.onTodoWrite([{ content: 'x', status: 'pending' }])
    expect(tracker.render()).toContain('▱▱▱▱▱▱▱▱▱▱ 0%')

    const t2 = new ProgressTracker({ now: () => 1000, startMs: 1000 })
    t2.onTodoWrite([
      { content: 'a', status: 'completed' },
      { content: 'b', status: 'completed' },
    ])
    expect(t2.render()).toContain('▰▰▰▰▰▰▰▰▰▰ 100%')
  })

  test('plan rendered after tool calls in correct order', () => {
    const t = new ProgressTracker({ now: () => 1000, startMs: 1000 })
    t.onTool('Bash', { command: 'ls' })
    t.onTodoWrite([{ content: 'task', status: 'in_progress' }])
    const out = t.render()
    const toolIdx = out.indexOf('▸ [B] bash ls')
    const planIdx = out.indexOf('plan:')
    expect(toolIdx).toBeGreaterThan(-1)
    expect(planIdx).toBeGreaterThan(toolIdx)
  })

  test('mixed tools render with their tags', () => {
    const t = new ProgressTracker({ now: () => 1000, startMs: 1000 })
    t.onTool('Read', { file_path: '/x/foo.ts' })
    t.onTool('Edit', { file_path: '/x/foo.ts' })
    t.onTool('Bash', { command: 'npm test' })
    t.onTool('Grep', { pattern: 'TODO' })
    t.onTool('Task', { subagent_type: 'reviewer' })
    const out = t.render()
    expect(out).toContain('[R] read x/foo.ts')
    expect(out).toContain('[W] edit x/foo.ts')
    expect(out).toContain('[B] bash npm test')
    expect(out).toContain('[G] grep "TODO"')
    expect(out).toContain('[A] task reviewer')
  })
})
