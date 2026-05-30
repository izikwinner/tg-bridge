export interface LoggerOpts {
  secrets: string[]
  sink?: (line: string) => void
}

export interface Logger {
  info: (msg: string, fields?: Record<string, unknown>) => void
  warn: (msg: string, fields?: Record<string, unknown>) => void
  error: (msg: string, fields?: Record<string, unknown>) => void
}

function redact(text: string, secrets: string[]): string {
  let out = text
  for (const s of secrets) {
    if (s.length > 0) out = out.replaceAll(s, '[REDACTED]')
  }
  return out
}

export function createLogger(opts: LoggerOpts): Logger {
  const sink = opts.sink ?? ((line: string) => process.stderr.write(line + '\n'))
  const emit = (level: string, msg: string, fields?: Record<string, unknown>) => {
    const ts = new Date().toISOString()
    const payload = fields ? ' ' + JSON.stringify(fields) : ''
    const raw = `[${ts}] [${level}] ${msg}${payload}`
    sink(redact(raw, opts.secrets))
  }
  return {
    info: (msg, fields) => emit('info', msg, fields),
    warn: (msg, fields) => emit('warn', msg, fields),
    error: (msg, fields) => emit('error', msg, fields),
  }
}
