const MARKER_END = /\s*\[REACT:([a-z_]+)\]\s*$/

export interface ParsedReply {
  text: string
  reactions: string[]
}

export function parseReply(input: string): ParsedReply {
  const reactions: string[] = []
  const keptLines: string[] = []
  for (const line of input.split('\n')) {
    const m = line.match(MARKER_END)
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
  return { text, reactions }
}
