import { describe, test, expect } from 'bun:test'
import { formatPostTool } from '../../src/hooks/post-tool'

describe('formatPostTool', () => {
  test('Bash → command', () => {
    expect(formatPostTool({ tool_name: 'Bash', tool_input: { command: 'ls -la' } }))
      .toBe('→ Bash: `ls -la`')
  })

  test('Read → file_path', () => {
    expect(formatPostTool({ tool_name: 'Read', tool_input: { file_path: '/etc/hosts' } }))
      .toBe('→ Read: `/etc/hosts`')
  })

  test('Edit → file_path', () => {
    expect(formatPostTool({ tool_name: 'Edit', tool_input: { file_path: 'src/foo.ts', old_string: 'a', new_string: 'b' } }))
      .toBe('→ Edit: `src/foo.ts`')
  })

  test('Grep → pattern', () => {
    expect(formatPostTool({ tool_name: 'Grep', tool_input: { pattern: 'TODO' } }))
      .toBe('→ Grep: `TODO`')
  })

  test('Task → description', () => {
    expect(formatPostTool({ tool_name: 'Task', tool_input: { description: 'review code' } }))
      .toBe('→ Task: `review code`')
  })

  test('WebFetch → url', () => {
    expect(formatPostTool({ tool_name: 'WebFetch', tool_input: { url: 'https://example.com' } }))
      .toBe('→ WebFetch: `https://example.com`')
  })

  test('unknown tool → first string arg', () => {
    expect(formatPostTool({ tool_name: 'mcp__gbrain__recall', tool_input: { query: 'foo' } }))
      .toBe('→ mcp__gbrain__recall: `foo`')
  })

  test('truncates long args to 80 chars with ellipsis', () => {
    const long = 'x'.repeat(200)
    const r = formatPostTool({ tool_name: 'Bash', tool_input: { command: long } })
    expect(r).toMatch(/^→ Bash: `x{79}…`$/)
  })

  test('first line only for multi-line commands', () => {
    const r = formatPostTool({ tool_name: 'Bash', tool_input: { command: 'line1\nline2\nline3' } })
    expect(r).toBe('→ Bash: `line1`')
  })

  test('legacy {tool, args} fields', () => {
    expect(formatPostTool({ tool: 'Bash', args: { command: 'pwd' } }))
      .toBe('→ Bash: `pwd`')
  })

  test('missing tool name → null', () => {
    expect(formatPostTool({})).toBeNull()
  })

  test('no arg → just tool name without backticks', () => {
    expect(formatPostTool({ tool_name: 'Bash', tool_input: {} }))
      .toBe('→ Bash')
  })
})
