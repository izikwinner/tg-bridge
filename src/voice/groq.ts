import { readFileSync } from 'fs'

const GROQ_URL = 'https://api.groq.com/openai/v1/audio/transcriptions'
const MODEL = 'whisper-large-v3'

export interface TranscribeOpts {
  apiKey: string
  audio: ArrayBuffer | Uint8Array
  filename: string
  mimeType: string
  language?: string
}

export async function transcribeAudio(opts: TranscribeOpts): Promise<string> {
  const form = new FormData()
  const blob = new Blob([opts.audio], { type: opts.mimeType })
  form.append('file', blob, opts.filename)
  form.append('model', MODEL)
  if (opts.language) form.append('language', opts.language)
  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${opts.apiKey}` },
    body: form,
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`groq ${res.status}: ${body.slice(0, 200)}`)
  }
  const data = (await res.json()) as { text?: string }
  return (data.text ?? '').trim()
}

export function loadGroqKey(file: string): string {
  return readFileSync(file, 'utf8').trim()
}
