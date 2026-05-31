// Resume-aware Claude session id for the tmux-driven interactive session.
//
// Unlike gateway.py (headless `claude -p --resume` per message), tg-bridge runs
// ONE long-lived interactive `claude` inside tmux. The conversation only needs
// to be (re)bound to a session id at *spawn* time — boot, hardRestart, crash.
// We persist a stable UUID and, on every spawn, choose:
//   * transcript missing → `--session-id <sid>`  (create it deterministically)
//   * transcript present → `--resume <sid>`      (continue the conversation)
// So a reboot/respawn re-attaches the same on-disk conversation instead of
// starting fresh — the durable-resume property gateway.py has.
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const SID_FILE = 'claude-session-id'

// Encode an absolute cwd the way Claude Code names its transcript project dir:
// every non-alphanumeric char becomes '-'.
//   /home/user/.claude-lab/agent/.claude -> -home-user--claude-lab-agent--claude
export function encodeProjectDir(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-')
}

// Where Claude Code writes the transcript for (cwd, sid).
export function transcriptPath(home: string, cwd: string, sid: string): string {
  return join(home, '.claude', 'projects', encodeProjectDir(cwd), `${sid}.jsonl`)
}

// Pure flag decision. `--session-id` requires an UNUSED id; `--resume` requires
// an EXISTING one — so transcript existence is exactly the right discriminator.
export function resumeFlag(sid: string, transcriptExists: boolean): string {
  return transcriptExists ? `--resume ${sid}` : `--session-id ${sid}`
}

export interface TranscriptEntry {
  name: string
  mtimeMs: number
}

function defaultListTranscripts(dir: string): TranscriptEntry[] {
  try {
    return readdirSync(dir).map((name) => ({
      name,
      mtimeMs: statSync(join(dir, name)).mtimeMs,
    }))
  } catch {
    return []
  }
}

// Session id of the newest existing transcript for this workspace, or null.
// Used to seed our persisted sid on first run so the conversation that is
// already live (under Claude's own auto-generated id) survives the first
// reboot/respawn — same "most recent conversation" semantics as --continue.
// `list` is injectable for tests.
export function latestTranscriptSid(
  home: string,
  workspace: string,
  list: (dir: string) => TranscriptEntry[] = defaultListTranscripts,
): string | null {
  const dir = join(home, '.claude', 'projects', encodeProjectDir(workspace))
  const entries = list(dir)
    .filter((e) => e.name.endsWith('.jsonl'))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
  const newest = entries[0]
  return newest ? newest.name.replace(/\.jsonl$/, '') : null
}

// Read the persisted sid, or generate + persist a fresh one. Stable across
// restarts; `gen` is injectable for tests.
export function loadOrCreateSid(stateDir: string, gen: () => string = randomUUID): string {
  const f = join(stateDir, SID_FILE)
  if (existsSync(f)) {
    const v = readFileSync(f, 'utf8').trim()
    if (v) return v
  }
  const sid = gen()
  mkdirSync(stateDir, { recursive: true })
  writeFileSync(f, sid + '\n')
  return sid
}

// Build the full resume-aware claude command for the tmux session. Re-evaluate
// on every spawn (`exists` is checked live) so hardRestart/reboot pick
// `--resume` once the transcript exists. `exists` is injectable for tests.
export function buildClaudeCommand(opts: {
  binary: string
  flags: string
  workspace: string
  sid: string
  home: string
  exists?: (p: string) => boolean
}): string {
  const exists = opts.exists ?? existsSync
  const tp = transcriptPath(opts.home, opts.workspace, opts.sid)
  const flag = resumeFlag(opts.sid, exists(tp))
  return `${opts.binary} ${opts.flags} ${flag}`.trim()
}
