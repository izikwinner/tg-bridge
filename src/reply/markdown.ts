const TABLE_SEP = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/

function isTableRow(line: string): boolean {
  return /\|/.test(line)
}

function splitRow(line: string): string[] {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|')) s = s.slice(0, -1)
  return s.split('|').map((c) => c.trim())
}

export function wrapTables(text: string): string {
  const lines = text.split('\n')
  const out: string[] = []
  let i = 0
  let inFence = false
  while (i < lines.length) {
    const line = lines[i]!
    if (/^```/.test(line)) {
      inFence = !inFence
      out.push(line)
      i++
      continue
    }
    if (inFence) {
      out.push(line)
      i++
      continue
    }
    if (
      isTableRow(line) &&
      i + 1 < lines.length &&
      TABLE_SEP.test(lines[i + 1]!)
    ) {
      const headers = splitRow(line)
      const block: string[] = []
      i += 2
      while (i < lines.length && isTableRow(lines[i]!)) {
        block.push(lines[i]!)
        i++
      }
      out.push(renderTableBlock(headers, block))
      continue
    }
    out.push(line)
    i++
  }
  return out.join('\n')
}

function renderTableBlock(headers: string[], rows: string[]): string {
  const groups: string[] = []
  for (const row of rows) {
    const cells = splitRow(row)
    const heading = cells[0] ?? ''
    const lines: string[] = [`**${heading}**`]
    for (let i = 1; i < cells.length; i++) {
      const colName = headers[i] ?? ''
      const val = cells[i] ?? ''
      if (val.length === 0) continue
      if (colName) lines.push(`- ${colName}: ${val}`)
      else lines.push(`- ${val}`)
    }
    groups.push(lines.join('\n'))
  }
  return groups.join('\n\n')
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

const PLACEHOLDER = '\x00'

interface Slot { html: string }

function placeholderAt(i: number): string {
  return `${PLACEHOLDER}${i}${PLACEHOLDER}`
}

export function markdownToHtml(input: string): string {
  const slots: Slot[] = []
  const stash = (html: string): string => {
    const idx = slots.length
    slots.push({ html })
    return placeholderAt(idx)
  }
  let s = input
  s = s.replace(/```([a-zA-Z0-9_-]*)\n?([\s\S]*?)```/g, (_m, _lang: string, code: string) => {
    return stash(`<pre><code>${escapeHtml(code.replace(/\n$/, ''))}</code></pre>`)
  })
  s = s.replace(/`([^`\n]+)`/g, (_m, code: string) => stash(`<code>${escapeHtml(code)}</code>`))
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_m, label: string, url: string) => {
    return stash(`<a href="${escapeHtml(url)}">${escapeHtml(label)}</a>`)
  })
  s = escapeHtml(s)
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
  s = s.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<i>$2</i>')
  s = s.replace(/__([^_\n]+)__/g, '<b>$1</b>')
  s = s.replace(/(^|[^_])_([^_\n]+)_(?!_)/g, '$1<i>$2</i>')
  const sep = PLACEHOLDER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  s = s.replace(new RegExp(`${sep}(\\d+)${sep}`, 'g'), (_m, num: string) => {
    const slot = slots[Number(num)]
    return slot ? slot.html : _m
  })
  return s
}

export function formatReplyHtml(input: string): string {
  return markdownToHtml(wrapTables(input))
}
