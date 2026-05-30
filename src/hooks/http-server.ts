export interface HookResponse {
  status: 200 | 400 | 401 | 500
  body: Record<string, unknown>
}

export interface HttpServerOpts {
  host: string
  port: number
  bearerToken: string
  onGbrainPush: (body: unknown) => Promise<HookResponse>
  onStop: (body: unknown) => Promise<HookResponse>
  onPreTool: (body: unknown) => Promise<HookResponse>
}

export interface HttpServerHandle {
  port: number
  stop(): Promise<void>
}

export async function startHttpServer(opts: HttpServerOpts): Promise<HttpServerHandle> {
  const server = Bun.serve({
    hostname: opts.host,
    port: opts.port,
    async fetch(req) {
      const url = new URL(req.url)
      if (url.pathname === '/health') {
        return Response.json({ ok: true })
      }
      const auth = req.headers.get('authorization') ?? ''
      if (auth !== `Bearer ${opts.bearerToken}`) {
        return new Response(JSON.stringify({ error: 'unauthorized' }), {
          status: 401, headers: { 'content-type': 'application/json' },
        })
      }
      let body: unknown
      try { body = await req.json() } catch { body = {} }
      let handler: ((b: unknown) => Promise<HookResponse>) | undefined
      if (url.pathname === '/hooks/agent') handler = opts.onGbrainPush
      else if (url.pathname === '/hooks/stop') handler = opts.onStop
      else if (url.pathname === '/hooks/pretool') handler = opts.onPreTool
      if (!handler) return new Response('not found', { status: 404 })
      const r = await handler(body)
      return new Response(JSON.stringify(r.body), {
        status: r.status, headers: { 'content-type': 'application/json' },
      })
    },
  })
  return { port: server.port, async stop() { server.stop(true) } }
}
