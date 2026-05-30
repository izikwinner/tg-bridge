import { readFile } from 'fs/promises'

export interface StopHookInput {
  transcript_path?: string
}

export interface StopHookOutput {
  assistant_message: string
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
      const parsed = JSON.parse(line) as { type?: string; content?: unknown }
      if (parsed.type === 'assistant') {
        const content = parsed.content
        return { assistant_message: typeof content === 'string' ? content : JSON.stringify(content) }
      }
    } catch { /* skip malformed */ }
  }
  return { assistant_message: '' }
}
