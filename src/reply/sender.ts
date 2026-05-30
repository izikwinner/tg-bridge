const TG_LIMIT = 4000

export function chunkForTelegram(text: string): string[] {
  if (text.length <= TG_LIMIT) return [text]
  const chunks: string[] = []
  let rest = text
  while (rest.length > TG_LIMIT) {
    const slice = rest.slice(0, TG_LIMIT)
    const nl = slice.lastIndexOf('\n')
    const useNewline = nl > TG_LIMIT * 0.5
    const cut = useNewline ? nl : TG_LIMIT
    chunks.push(rest.slice(0, cut))
    rest = rest.slice(cut + (useNewline ? 1 : 0))
  }
  if (rest.length > 0) chunks.push(rest)
  return chunks
}
