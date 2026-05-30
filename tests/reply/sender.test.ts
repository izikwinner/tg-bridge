import { describe, test, expect } from 'bun:test'
import { chunkForTelegram } from '../../src/reply/sender'

describe('chunkForTelegram', () => {
  test('short text returns single chunk', () => {
    expect(chunkForTelegram('hello')).toEqual(['hello'])
  })

  test('splits on newline boundary near 4000', () => {
    const long = ('line\n'.repeat(900)).trimEnd()
    const chunks = chunkForTelegram(long)
    expect(chunks.length).toBeGreaterThan(1)
    chunks.forEach(c => expect(c.length).toBeLessThanOrEqual(4000))
    expect(chunks.join('\n')).toBe(long)
  })

  test('hard splits when no newline boundary', () => {
    const long = 'a'.repeat(5000)
    const chunks = chunkForTelegram(long)
    expect(chunks.length).toBe(2)
    expect(chunks[0]!.length).toBe(4000)
    expect(chunks[1]!.length).toBe(1000)
  })
})
