const REACT_MARKER = /\s*\[REACT:([a-z_]+)\]\s*$/
const BUTTONS_MARKER = /\s*\[BUTTONS:\s*([^\]]+)\]\s*$/
const FILE_MARKER = /\s*\[FILE:\s*([^\]]+)\]\s*$/

export interface ParsedButton {
  label: string
  payload: string
}

export interface ParsedFile {
  path: string
  caption?: string
  kind?: 'photo' | 'video' | 'document' | 'voice'
}

export interface ParsedReply {
  text: string
  reactions: string[]
  buttons: ParsedButton[]
  files: ParsedFile[]
}

function parseFileSpec(raw: string): ParsedFile | null {
  const s = raw.trim()
  if (s.length === 0) return null
  let path = s
  let caption: string | undefined
  let kind: ParsedFile['kind']
  const capIdx = s.search(/\s+caption=/)
  const kindIdx = s.search(/\s+kind=/)
  const firstAttr = [capIdx, kindIdx].filter((i) => i >= 0).sort((a, b) => a - b)[0]
  if (firstAttr !== undefined) {
    path = s.slice(0, firstAttr).trim()
    const tail = s.slice(firstAttr)
    const cap = tail.match(/\s+caption=("([^"]*)"|([^\s][^\s]*(?:\s+(?!kind=)[^\s]+)*))/)
    if (cap) caption = (cap[2] ?? cap[3] ?? '').trim()
    const kk = tail.match(/\s+kind=(photo|video|document|voice)/i)
    if (kk && kk[1]) kind = kk[1].toLowerCase() as ParsedFile['kind']
  }
  if (path.length === 0) return null
  const out: ParsedFile = { path }
  if (caption !== undefined && caption.length > 0) out.caption = caption
  if (kind !== undefined) out.kind = kind
  return out
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
  const files: ParsedFile[] = []
  const keptLines: string[] = []
  const safe = typeof input === 'string' ? input : ''
  for (const line of safe.split('\n')) {
    const file = line.match(FILE_MARKER)
    if (file && file[1]) {
      const parsed = parseFileSpec(file[1])
      if (parsed) files.push(parsed)
      const leading = line.slice(0, file.index).replace(/\s+$/, '')
      if (leading.length > 0) keptLines.push(leading)
      continue
    }
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
  return { text, reactions, buttons, files }
}
