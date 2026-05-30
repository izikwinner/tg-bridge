import { describe, test, expect } from 'bun:test'
import { parseReply } from '../../src/reply/parser'

describe('parseReply', () => {
  test('extracts single REACT marker', () => {
    const r = parseReply('Saved. [REACT:thumbsup]\nMore text.')
    expect(r.reactions).toEqual(['thumbsup'])
    expect(r.text).toBe('Saved.\nMore text.')
  })

  test('extracts multiple REACT markers', () => {
    const r = parseReply('[REACT:thumbsup]\nOK\n[REACT:eyes]')
    expect(r.reactions).toEqual(['thumbsup', 'eyes'])
    expect(r.text.trim()).toBe('OK')
  })

  test('no markers — passes through', () => {
    const r = parseReply('Hello world')
    expect(r.reactions).toEqual([])
    expect(r.text).toBe('Hello world')
  })

  test('ignores invalid marker shapes', () => {
    const r = parseReply('[REACT:UPPER] text [REACT: bad]')
    expect(r.reactions).toEqual([])
    expect(r.text).toBe('[REACT:UPPER] text [REACT: bad]')
  })

  test('marker on its own line is removed cleanly', () => {
    const r = parseReply('line1\n[REACT:fire]\nline2')
    expect(r.reactions).toEqual(['fire'])
    expect(r.text).toBe('line1\nline2')
  })
})
