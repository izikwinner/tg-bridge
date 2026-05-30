import { describe, test, expect } from 'bun:test'
import { needsRelay } from '../../src/permission/policy'

const policy = {
  relay_patterns: ['Bash(sudo *)', 'Bash(rm -rf*)'],
  default: 'allow' as const,
}

describe('needsRelay', () => {
  test('sudo matches', () => {
    expect(needsRelay({ tool: 'Bash', args: { command: 'sudo apt update' } }, policy)).toBe(true)
  })

  test('rm -rf matches', () => {
    expect(needsRelay({ tool: 'Bash', args: { command: 'rm -rf /tmp/x' } }, policy)).toBe(true)
  })

  test('benign Bash does not relay', () => {
    expect(needsRelay({ tool: 'Bash', args: { command: 'ls -la' } }, policy)).toBe(false)
  })

  test('non-Bash tool does not relay', () => {
    expect(needsRelay({ tool: 'Read', args: { file: 'x' } }, policy)).toBe(false)
  })
})
