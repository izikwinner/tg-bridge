import { readFile } from 'fs/promises'

export interface StopHookInput {
  transcript_path?: string
}

export interface StopHookOutput {
  assistant_message: string
}

interface TextBlock { type: 'text'; text: string }
type ContentBlock = TextBlock | { type: string; [k: string]: unknown }

function extractText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return (content as ContentBlock[])
      .filter((b): b is TextBlock => b?.type === 'text' && typeof (b as TextBlock).text === 'string')
      .map(b => b.text)
      .join('\n')
  }
  return ''
}

export async function handleStopHook(input: StopHookInput): Promise<StopHookOutput> {
  if (!input.transcript_path) return { assistant_message: '' }
  const raw = await readFile(input.transcript_path, 'utf8').catch(() => '')
  if (raw.length === 0) return { assistant_message: '' }
  const lines = raw.trim().split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]
    if (!line) continue
    try {
      const parsed = JSON.parse(line) as {
        type?: string
        content?: unknown
        message?: { role?: string; content?: unknown }
      }
      if (parsed.type === 'assistant') {
        const text = extractText(parsed.message?.content ?? parsed.content)
        if (text.length > 0) return { assistant_message: text }
      }
    } catch { /* skip malformed */ }
  }
  return { assistant_message: '' }
}
