import { describe, test, expect } from 'bun:test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  encodeProjectDir,
  transcriptPath,
  resumeFlag,
  buildClaudeCommand,
  loadOrCreateSid,
  latestTranscriptSid,
} from '../../src/claude/session-id'

describe('encodeProjectDir', () => {
  test('maps a workspace path the way Claude names its project dir', () => {
    expect(encodeProjectDir('/home/user')).toBe('-home-user')
    expect(encodeProjectDir('/home/user/.claude-lab/agent/.claude')).toBe(
      '-home-user--claude-lab-agent--claude',
    )
  })
})

describe('transcriptPath', () => {
  test('points at <home>/.claude/projects/<enc>/<sid>.jsonl', () => {
    const p = transcriptPath('/home/user', '/home/user', 'abc-123')
    expect(p).toBe('/home/user/.claude/projects/-home-user/abc-123.jsonl')
  })
})

describe('resumeFlag', () => {
  test('--session-id when no transcript yet (creates it)', () => {
    expect(resumeFlag('sid-1', false)).toBe('--session-id sid-1')
  })
  test('--resume once transcript exists', () => {
    expect(resumeFlag('sid-1', true)).toBe('--resume sid-1')
  })
})

describe('buildClaudeCommand', () => {
  const base = {
    binary: 'claude',
    flags: '--dangerously-skip-permissions',
    workspace: '/home/user',
    sid: 'sid-9',
    home: '/home/user',
  }
  test('first spawn → --session-id', () => {
    const cmd = buildClaudeCommand({ ...base, exists: () => false })
    expect(cmd).toBe('claude --dangerously-skip-permissions --session-id sid-9')
  })
  test('respawn after transcript exists → --resume', () => {
    const cmd = buildClaudeCommand({ ...base, exists: () => true })
    expect(cmd).toBe('claude --dangerously-skip-permissions --resume sid-9')
  })
  test('only the matching transcript path triggers --resume', () => {
    const want = transcriptPath(base.home, base.workspace, base.sid)
    const cmd = buildClaudeCommand({ ...base, exists: (p) => p === want })
    expect(cmd).toBe('claude --dangerously-skip-permissions --resume sid-9')
  })
})

describe('latestTranscriptSid', () => {
  test('returns null when no transcripts exist', () => {
    expect(latestTranscriptSid('/home/user', '/ws', () => [])).toBeNull()
  })
  test('picks the newest .jsonl by mtime, strips extension', () => {
    const list = () => [
      { name: 'old.jsonl', mtimeMs: 100 },
      { name: 'newest.jsonl', mtimeMs: 300 },
      { name: 'mid.jsonl', mtimeMs: 200 },
      { name: 'notes.txt', mtimeMs: 999 }, // ignored: not a transcript
    ]
    expect(latestTranscriptSid('/home/user', '/ws', list)).toBe('newest')
  })
})

describe('loadOrCreateSid', () => {
  test('generates + persists a sid on first call', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sid-'))
    const sid = loadOrCreateSid(dir, () => 'fixed-uuid')
    expect(sid).toBe('fixed-uuid')
    expect(readFileSync(join(dir, 'claude-session-id'), 'utf8').trim()).toBe('fixed-uuid')
  })
  test('returns the persisted sid on subsequent calls (stable)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sid-'))
    const first = loadOrCreateSid(dir, () => 'aaa')
    const second = loadOrCreateSid(dir, () => 'bbb')
    expect(first).toBe('aaa')
    expect(second).toBe('aaa')
  })
  test('regenerates when the persisted file is empty', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sid-'))
    writeFileSync(join(dir, 'claude-session-id'), '   \n')
    const sid = loadOrCreateSid(dir, () => 'regen')
    expect(sid).toBe('regen')
  })
})
