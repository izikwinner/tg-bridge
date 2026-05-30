const REACT_MARKER = /\s*\[REACT:([a-z_]+)\]\s*$/
const BUTTONS_MARKER = /\s*\[BUTTONS:\s*([^\]]+)\]\s*$/

export interface ParsedButton {
  label: string
  payload: string
}

export interface ParsedReply {
  text: string
  reactions: string[]
  buttons: ParsedButton[]
}

function parseButtonsList(raw: string): ParsedButton[] {
  return raw
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const eq = entry.indexOf('=')
      if (eq === -1) {
        const label = entry.slice(0, 32)
        return { label, payload: label }
      }
      const label = entry.slice(0, eq).trim().slice(0, 32)
      const payload = entry.slice(eq + 1).trim().slice(0, 59)
      return { label, payload }
    })
    .filter((b) => b.label.length > 0 && b.payload.length > 0)
    .slice(0, 8)
}

export function parseReply(input: string | undefined | null): ParsedReply {
  const reactions: string[] = []
  const buttons: ParsedButton[] = []
  const keptLines: string[] = []
  const safe = typeof input === 'string' ? input : ''
  for (const line of safe.split('\n')) {
    const btn = line.match(BUTTONS_MARKER)
    if (btn && btn[1]) {
      buttons.push(...parseButtonsList(btn[1]))
      const leading = line.slice(0, btn.index).replace(/\s+$/, '')
      if (leading.length > 0) keptLines.push(leading)
      continue
    }
    const m = line.match(REACT_MARKER)
    if (m && m[1]) {
      reactions.push(m[1])
      const leading = line.slice(0, m.index).replace(/\s+$/, '')
      if (leading.length > 0) keptLines.push(leading)
    } else {
      keptLines.push(line)
    }
  }
  let text = keptLines.join('\n')
  text = text.replace(/^\s*\n+/, '').replace(/\n+\s*$/, '')
  return { text, reactions, buttons }
}
