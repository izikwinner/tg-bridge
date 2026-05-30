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

  test('extracts BUTTONS marker with label=payload pairs', () => {
    const r = parseReply('Tanlang:\n[BUTTONS: Ha=yes | Yoq=no | Boshqa=other]')
    expect(r.buttons).toEqual([
      { label: 'Ha', payload: 'yes' },
      { label: 'Yoq', payload: 'no' },
      { label: 'Boshqa', payload: 'other' },
    ])
    expect(r.text).toBe('Tanlang:')
  })

  test('BUTTONS with bare label uses label as payload', () => {
    const r = parseReply('[BUTTONS: Cancel | Retry]')
    expect(r.buttons).toEqual([
      { label: 'Cancel', payload: 'Cancel' },
      { label: 'Retry', payload: 'Retry' },
    ])
  })

  test('BUTTONS payload truncated to 59 chars', () => {
    const r = parseReply('[BUTTONS: x=' + 'a'.repeat(100) + ']')
    expect(r.buttons[0]?.payload.length).toBe(59)
  })

  test('BUTTONS cap at 8 entries', () => {
    const entries = Array.from({length: 12}, (_, i) => `b${i}=${i}`).join(' | ')
    const r = parseReply(`[BUTTONS: ${entries}]`)
    expect(r.buttons.length).toBe(8)
  })

  test('reply with both REACT and BUTTONS', () => {
    const r = parseReply('Done.\n[REACT:thumbsup]\n[BUTTONS: Continue=cont]')
    expect(r.reactions).toEqual(['thumbsup'])
    expect(r.buttons).toEqual([{ label: 'Continue', payload: 'cont' }])
    expect(r.text.trim()).toBe('Done.')
  })

  test('FILE marker — bare path', () => {
    const r = parseReply('Hisobot:\n[FILE: /tmp/report.pdf]')
    expect(r.files).toEqual([{ path: '/tmp/report.pdf' }])
    expect(r.text).toBe('Hisobot:')
  })

  test('FILE marker — path with caption', () => {
    const r = parseReply('[FILE: /tmp/graph.png caption="May usage"]')
    expect(r.files).toEqual([{ path: '/tmp/graph.png', caption: 'May usage' }])
  })

  test('FILE marker — path with explicit kind', () => {
    const r = parseReply('[FILE: /tmp/scan.jpg kind=document]')
    expect(r.files[0]?.kind).toBe('document')
  })

  test('FILE marker — multiple files', () => {
    const r = parseReply('[FILE: /a.png]\n[FILE: /b.pdf]')
    expect(r.files).toHaveLength(2)
    expect(r.files[0]?.path).toBe('/a.png')
    expect(r.files[1]?.path).toBe('/b.pdf')
  })
})
