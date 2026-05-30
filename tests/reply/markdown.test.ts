import { describe, test, expect } from 'bun:test'
import { wrapTables, markdownToHtml, formatReplyHtml } from '../../src/reply/markdown'

describe('wrapTables', () => {
  test('GFM table becomes bold heading + bullets per row', () => {
    const md = [
      '| Name | Role | Status |',
      '|------|------|--------|',
      '| Alice | dev | done |',
      '| Bob | qa | working |',
    ].join('\n')
    const out = wrapTables(md)
    expect(out).toContain('**Alice**')
    expect(out).toContain('- Role: dev')
    expect(out).toContain('- Status: done')
    expect(out).toContain('**Bob**')
    expect(out).toContain('- Role: qa')
  })

  test('table inside code fence is left alone', () => {
    const md = '```\n| a | b |\n|---|---|\n| 1 | 2 |\n```'
    expect(wrapTables(md)).toBe(md)
  })

  test('non-table pipe text untouched', () => {
    expect(wrapTables('foo | bar | baz')).toBe('foo | bar | baz')
  })

  test('preserves text around the table', () => {
    const md = 'before\n\n| h |\n|---|\n| v |\n\nafter'
    const out = wrapTables(md)
    expect(out.startsWith('before')).toBe(true)
    expect(out.trimEnd().endsWith('after')).toBe(true)
    expect(out).toContain('**v**')
  })
})

describe('markdownToHtml', () => {
  test('inline code', () => {
    expect(markdownToHtml('use `npm test` now')).toBe('use <code>npm test</code> now')
  })

  test('bold + italic', () => {
    expect(markdownToHtml('**bold** and *italic*')).toBe('<b>bold</b> and <i>italic</i>')
  })

  test('fenced code with lang', () => {
    expect(markdownToHtml('```js\nconst x = 1\n```')).toBe('<pre><code>const x = 1</code></pre>')
  })

  test('link', () => {
    expect(markdownToHtml('see [docs](https://example.com)'))
      .toBe('see <a href="https://example.com">docs</a>')
  })

  test('HTML in plain text is escaped', () => {
    expect(markdownToHtml('1 < 2 & 3 > 0')).toBe('1 &lt; 2 &amp; 3 &gt; 0')
  })

  test('does not double-escape inside code', () => {
    expect(markdownToHtml('`a < b`')).toBe('<code>a &lt; b</code>')
  })
})

describe('formatReplyHtml', () => {
  test('combines table conversion + inline formatting', () => {
    const md = [
      'Report:',
      '| Name | Note |',
      '|------|------|',
      '| Bob | needs **review** |',
    ].join('\n')
    const out = formatReplyHtml(md)
    expect(out).toContain('Report:')
    expect(out).toContain('<b>Bob</b>')
    expect(out).toContain('<b>review</b>')
  })
})
