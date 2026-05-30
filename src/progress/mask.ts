const IPV4 = /\b(\d{1,3})\.\d{1,3}\.\d{1,3}\.(\d{1,3})\b/g
const SECRET_PATH = /(\S*?secrets\/)\S+/g
const BOT_TOKEN = /\b(\d{3})\d{7,}:(AA\w{2})\w+/g
const SUPABASE_URL = /([a-z0-9]{10,})\.supabase\.co/g
const LONG_TOKEN = /\b([A-Za-z0-9_-]{4})[A-Za-z0-9_-]{16,}([A-Za-z0-9_-]{4})\b/g

export function maskSecrets(s: string): string {
  if (!s) return s
  let out = s
  out = out.replace(IPV4, '$1.***.***.$2')
  out = out.replace(SECRET_PATH, '$1***')
  out = out.replace(BOT_TOKEN, '$1***:$2***')
  out = out.replace(SUPABASE_URL, (_m, host: string) => {
    if (host.length <= 8) return `${host}.supabase.co`
    return `${host.slice(0, 4)}*****${host.slice(-4)}.supabase.co`
  })
  out = out.replace(LONG_TOKEN, '$1***$2')
  return out
}
