const TMUX = '/usr/bin/tmux'

export interface TmuxSessionOpts {
  socket: string
  session: string
  cwd: string
  // Re-evaluated on every (re)spawn so the resume flag is recomputed from the
  // current on-disk transcript state (first boot → --session-id, respawn after
  // a transcript exists → --resume). See session-id.ts:buildClaudeCommand.
  buildCommand: () => string
}

export interface TmuxSession {
  exists(): Promise<boolean>
  ensure(): Promise<void>
  sendKeys(text: string): Promise<void>
  sendEscape(): Promise<void>
  hardRestart(): Promise<void>
  capturePane(): Promise<string>
  kill(): Promise<void>
}

async function run(args: string[]): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  const proc = Bun.spawn([TMUX, ...args], { stdout: 'pipe', stderr: 'pipe' })
  const exit = await proc.exited
  const stdout = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()
  return { ok: exit === 0, stdout, stderr }
}

export function createTmuxSession(opts: TmuxSessionOpts): TmuxSession {
  const baseArgs = ['-L', opts.socket]
  return {
    async exists() {
      const r = await run([...baseArgs, 'has-session', '-t', opts.session])
      return r.ok
    },
    async ensure() {
      const r = await run([...baseArgs, 'has-session', '-t', opts.session])
      if (r.ok) return
      const r2 = await run([
        ...baseArgs, 'new-session', '-d', '-s', opts.session,
        '-c', opts.cwd, opts.buildCommand(),
      ])
      if (!r2.ok) throw new Error(`tmux new-session failed: ${r2.stderr}`)
    },
    async sendKeys(text) {
      const r1 = await run([...baseArgs, 'send-keys', '-t', opts.session, '-l', text])
      if (!r1.ok) throw new Error(`tmux send-keys (text) failed: ${r1.stderr}`)
      await new Promise((resolve) => setTimeout(resolve, 150))
      const r2 = await run([...baseArgs, 'send-keys', '-t', opts.session, 'Enter'])
      if (!r2.ok) throw new Error(`tmux send-keys (Enter) failed: ${r2.stderr}`)
    },
    async sendEscape() {
      // Soft interrupt — only works while Claude's input loop is responsive.
      await run([...baseArgs, 'send-keys', '-t', opts.session, 'Escape'])
    },
    async hardRestart() {
      // Kill + respawn the Claude process. Used when the TUI is wedged (modal
      // stuck, input loop dead/lagged) and no keystroke can recover it. This is
      // the only reliable /new when send-keys is being ignored.
      await run([...baseArgs, 'kill-session', '-t', opts.session])
      await new Promise((resolve) => setTimeout(resolve, 300))
      const r = await run([
        ...baseArgs, 'new-session', '-d', '-s', opts.session,
        '-c', opts.cwd, opts.buildCommand(),
      ])
      if (!r.ok) throw new Error(`tmux new-session (restart) failed: ${r.stderr}`)
    },
    async capturePane() {
      const r = await run([...baseArgs, 'capture-pane', '-t', opts.session, '-p'])
      if (!r.ok) throw new Error(`tmux capture-pane failed: ${r.stderr}`)
      return r.stdout
    },
    async kill() {
      await run([...baseArgs, 'kill-server'])
    },
  }
}
