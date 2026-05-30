import { describe, test, expect, afterEach } from 'bun:test'
import { startHttpServer, type HttpServerHandle } from '../../src/hooks/http-server'

const noop = async () => ({ status: 200 as const, body: { ok: true } })

describe('http-server', () => {
  let handle: HttpServerHandle | null = null
  afterEach(async () => { await handle?.stop(); handle = null })

  test('401 on missing bearer for gbrain endpoint', async () => {
    handle = await startHttpServer({
      host: '127.0.0.1', port: 0,
      bearerToken: 'sekret',
      onGbrainPush: noop,
      onStop: noop,
      onPreTool: noop,
      onPostTool: noop,
    })
    const res = await fetch(`http://127.0.0.1:${handle.port}/hooks/agent`, {
      method: 'POST', body: '{}',
    })
    expect(res.status).toBe(401)
  })

  test('200 on correct bearer', async () => {
    handle = await startHttpServer({
      host: '127.0.0.1', port: 0,
      bearerToken: 'sekret',
      onGbrainPush: noop, onStop: noop, onPreTool: noop, onPostTool: noop,
    })
    const res = await fetch(`http://127.0.0.1:${handle.port}/hooks/agent`, {
      method: 'POST',
      body: '{"x":1}',
      headers: { Authorization: 'Bearer sekret' },
    })
    expect(res.status).toBe(200)
  })

  test('/hooks/posttool routes to onPostTool', async () => {
    let seen: unknown = null
    handle = await startHttpServer({
      host: '127.0.0.1', port: 0,
      bearerToken: 'sekret',
      onGbrainPush: noop, onStop: noop, onPreTool: noop,
      onPostTool: async (body) => { seen = body; return { status: 200, body: { ok: true } } },
    })
    const res = await fetch(`http://127.0.0.1:${handle.port}/hooks/posttool`, {
      method: 'POST',
      body: '{"tool_name":"Bash"}',
      headers: { Authorization: 'Bearer sekret' },
    })
    expect(res.status).toBe(200)
    expect((seen as { tool_name?: string }).tool_name).toBe('Bash')
  })

  test('/health returns 200 without auth', async () => {
    handle = await startHttpServer({
      host: '127.0.0.1', port: 0,
      bearerToken: 'sekret',
      onGbrainPush: noop, onStop: noop, onPreTool: noop, onPostTool: noop,
    })
    const res = await fetch(`http://127.0.0.1:${handle.port}/health`)
    expect(res.status).toBe(200)
  })
})
