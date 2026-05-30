import { describe, test, expect } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { handleStopHook } from '../../src/hooks/stop'

describe('handleStopHook', () => {
  test('reads last assistant message from transcript file', async () => {
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

  test('returns empty if no assistant turn', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'stop-'))
    const transcript = join(dir, 'transcript.jsonl')
    writeFileSync(transcript, JSON.stringify({ type: 'user', content: 'hi' }))
    const r = await handleStopHook({ transcript_path: transcript })
    expect(r.assistant_message).toBe('')
  })
})
