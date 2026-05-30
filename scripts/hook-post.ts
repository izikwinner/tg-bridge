import { readFileSync } from 'fs'

const url = process.env['TG_BRIDGE_URL']
const tokenFile = process.env['TG_BRIDGE_TOKEN_FILE']
if (!url || !tokenFile) {
  process.stderr.write('hook-post: missing TG_BRIDGE_URL or TG_BRIDGE_TOKEN_FILE\n')
  process.exit(0)
}
let token = ''
try { token = readFileSync(tokenFile, 'utf8').trim() } catch { /* fallback */ }

const stdin = await new Response(Bun.stdin.stream()).text()
const body = stdin.length > 0 ? stdin : '{}'

try {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
    body,
  })
  if (process.env['TG_BRIDGE_DEBUG']) {
    process.stderr.write(`hook-post: ${r.status}\n`)
  }
  if (url.endsWith('/pretool')) {
    const text = await r.text()
    process.stdout.write(text)
  }
} catch (err) {
  process.stderr.write(`hook-post: ${String(err)}\n`)
}
process.exit(0)
