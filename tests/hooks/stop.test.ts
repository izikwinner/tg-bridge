import { describe, test, expect } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { handleStopHook } from '../../src/hooks/stop'

describe('handleStopHook', () => {
  test('prefers last_assistant_message from payload (Claude Code 2.x direct field)', async () => {
    const r = await handleStopHook({ last_assistant_message: 'direct answer' })
    expect(r.assistant_message).toBe('direct answer')
  })

  test('extracts text blocks from last_assistant_message array', async () => {
    const r = await handleStopHook({
      last_assistant_message: [{ type: 'text', text: 'hello' }, { type: 'text', text: 'world' }],
    })
    expect(r.assistant_message).toBe('hello\nworld')
  })

  test('falls back to transcript when last_assistant_message empty', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'stop-'))
    const transcript = join(dir, 'transcript.jsonl')
    writeFileSync(transcript, JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'fallback' }] } }))
    const r = await handleStopHook({ last_assistant_message: '', transcript_path: transcript })
    expect(r.assistant_message).toBe('fallback')
  })

  test('reads last assistant message (legacy string content)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'stop-'))
    const transcript = join(dir, 'transcript.jsonl')
    writeFileSync(transcript, [
      JSON.stringify({ type: 'user', content: 'hi' }),
      JSON.stringify({ type: 'assistant', content: 'first' }),
      JSON.stringify({ type: 'user', content: '...' }),
      JSON.stringify({ type: 'assistant', content: 'final answer' }),
    ].join('\n'))

    const r = await handleStopHook({ transcript_path: transcript })
    expect(r.assistant_message).toBe('final answer')
  })

  test('reads last assistant from Claude Code 2.x format (message.content blocks)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'stop-'))
    const transcript = join(dir, 'transcript.jsonl')
    writeFileSync(transcript, [
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'hi' } }),
      JSON.stringify({
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'text', text: 'hello' }, { type: 'text', text: 'world' }] },
      }),
    ].join('\n'))
    const r = await handleStopHook({ transcript_path: transcript })
    expect(r.assistant_message).toBe('hello\nworld')
  })

  test('skips assistant turns with only tool_use blocks (no text)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'stop-'))
    const transcript = join(dir, 'transcript.jsonl')
    writeFileSync(transcript, [
      JSON.stringify({
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'text', text: 'real answer' }] },
      }),
      JSON.stringify({
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Read' }] },
      }),
    ].join('\n'))
    const r = await handleStopHook({ transcript_path: transcript })
    expect(r.assistant_message).toBe('real answer')
  })

  test('returns empty if no assistant turn', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'stop-'))
    const transcript = join(dir, 'transcript.jsonl')
    writeFileSync(transcript, JSON.stringify({ type: 'user', content: 'hi' }))
    const r = await handleStopHook({ transcript_path: transcript })
    expect(r.assistant_message).toBe('')
  })

  test('always returns string, never undefined', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'stop-'))
    const transcript = join(dir, 'transcript.jsonl')
    writeFileSync(transcript, JSON.stringify({ type: 'assistant', message: { content: undefined } }))
    const r = await handleStopHook({ transcript_path: transcript })
    expect(typeof r.assistant_message).toBe('string')
  })
})
