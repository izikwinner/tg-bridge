import { describe, test, expect, afterAll } from 'bun:test'
import { createTmuxSession } from '../../src/claude/tmux-session'
import { existsSync } from 'fs'

const TMUX = '/usr/bin/tmux'
const SOCK = 'tgbridge-int-test'
const SESS = 'inttest'

describe('tmux-session (integration)', () => {
  if (!existsSync(TMUX)) {
    test.skip('tmux not installed', () => {})
    return
  }

  afterAll(async () => {
    try {
      await Bun.spawn([TMUX, '-L', SOCK, 'kill-server']).exited
    } catch { /* ignore */ }
  })

  test('ensure starts a new session', async () => {
    const s = createTmuxSession({
      socket: SOCK,
      session: SESS,
      cwd: '/tmp',
      command: '/bin/sh',
    })
    await s.ensure()
    expect(await s.exists()).toBe(true)
  })

  test('sendKeys delivers text + Enter', async () => {
    const s = createTmuxSession({
      socket: SOCK,
      session: SESS,
      cwd: '/tmp',
      command: '/bin/sh',
    })
    await s.ensure()
    await s.sendKeys('echo hello-tmux-int')
    await new Promise(r => setTimeout(r, 300))
    const pane = await s.capturePane()
    expect(pane).toContain('hello-tmux-int')
  })
})
