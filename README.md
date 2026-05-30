# tg-bridge

Custom Telegram bridge for **interactive** Claude Code sessions. Replaces the `claude -p` (Agent SDK) gateway pattern before Anthropic's **2026-06-15 billing split** which moves SDK calls into a separate $200/mo pool.

One bridge process per agent. Each bridge owns a long-lived tmux session running `claude --dangerously-skip-permissions`. Telegram messages are forwarded into the tmux session as keystrokes; Claude Code hooks call back into the bridge to deliver replies, permission prompts, and live tool-call progress.

```
operator ──Telegram──> grammY poller ──tmux send-keys──> claude (interactive)
                                                            │
                                                            ├─ PostToolUse ─┐
                                                            ├─ PreToolUse ──┤  HTTP /hooks/*
                                                            └─ Stop ────────┘  (Bearer auth)
                                                                  │
operator <──Telegram── editMessageText / sendMessage <───── bridge HTTP server
```

## Why this exists

The old [jarvis-telegram-gateway](https://github.com/qwwiwi/jarvis-telegram-gateway) spawned a fresh `claude -p ... stream-json` per message. After **2026-06-15** each such call bills from the SDK pool instead of the Max subscription. This bridge keeps **one** interactive Claude Code session per agent — costs stay in Max.

## Features

- **Receipt reaction** — 👀 on the operator's message as soon as it's accepted
- **Live progress** — single `<pre>working — Xs … ▸ [B] bash git status</pre>` message that's edited in place as tool calls fire (PostToolUse hook)
- **Tool tags** — `[R]ead [W]rite [B]ash [G]rep [F]etch [S]earch [A]gent [T]odoWrite`
- **Done reaction** — 👍 (or whatever the assistant emits via `[REACT:slug]`) on the original message after Stop
- **Permission relay** — PreToolUse hook can prompt the operator with Allow/Deny inline buttons for sensitive tools (configurable via `permission-policy.yaml`)
- **Persona injection** — optional `[Operator/<user_id>]` prefix on inbound messages so the agent sees who's writing (alisher-style multi-user routing)
- **gbrain swarm ingress** — `POST /hooks/agent` accepts cross-agent pushes from the gbrain swarm-worker
- **FSM-gated queue** — IDLE / BUSY / WAITING_PERMISSION; messages received during BUSY are queued in FIFO order
- **Allow-list gate** — drops anything not from configured user_ids/chat_ids

## Tech stack

- Bun 1.3+ (no separate build step — systemd runs `bun run src/server.ts` directly)
- TypeScript strict mode (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`)
- [grammY](https://grammy.dev) for Telegram
- tmux 3.4+ — per-agent socket (`-L tgbridge-<agent>`) keeps sessions isolated
- zod for env validation
- js-yaml for permission policy
- bun:test for unit + integration tests

## Repo layout

```
src/
  server.ts                 main wiring (HTTP, bot, FSM, tmux, tracker)
  config.ts                 zod env schema (strictBool for "false" handling)
  log.ts                    redact-aware structured logger
  claude/
    state.ts                FSM
    queue.ts                bounded FIFO
    tmux-session.ts         tmux socket controller
  hooks/
    http-server.ts          Bun.serve with Bearer auth, routes /hooks/*
    stop.ts                 Stop hook → assistant_message (prefers `last_assistant_message`)
    post-tool.ts            (legacy) single-line per-tool formatter
  progress/
    tracker.ts              edit-in-place ProgressTracker (current progress UI)
  permission/
    policy.ts               YAML pattern matcher (which tools need operator confirmation)
    relay.ts                inline-button Allow/Deny round-trip
  reply/
    parser.ts               extracts `[REACT:slug]` markers from assistant reply
    sender.ts               Telegram message chunking (4096-byte limit)
  telegram/
    bot.ts                  grammY wrapper (sendText, sendHtml, editHtml, setReaction)
    gate.ts                 allow-list
  persona/
    sender-prefix.ts        optional inbound prefix injection
scripts/
  install-hooks.sh          patches <workspace>/.claude/settings.json with Stop+PreToolUse+PostToolUse
  hook-post.ts              generic hook adapter (stdin → bridge HTTP)
deploy/
  tg-bridge@.service        systemd template (EnvironmentFile per agent)
  tg-bridge.target          umbrella target
tests/                      bun:test (95+ tests, all green)
```

## Hooks installed into the agent's settings

`install-hooks.sh` patches `<workspace>/.claude/settings.json` with markered entries (idempotent — re-running replaces them):

| Event | Endpoint | Purpose |
|---|---|---|
| `Stop` | `/hooks/stop` | Deliver the assistant's final reply to Telegram, set 👍/`[REACT:*]` reaction |
| `PreToolUse` | `/hooks/pretool` | Pattern-matched policy: passthrough (allow) or prompt operator with Allow/Deny |
| `PostToolUse` | `/hooks/posttool` | Append tool to ProgressTracker, debounce-edit the in-place progress message |

## Quick start

Per agent:

```bash
# 1. Configure
mkdir -p ~/.claude-lab/<agent>/.claude/tg-bridge/state
cat > ~/.claude-lab/<agent>/.claude/tg-bridge/channel.env <<EOF
TELEGRAM_BOT_TOKEN=...
TELEGRAM_BOT_ID=...
TELEGRAM_ALLOWED_USER_IDS=5660438838
TELEGRAM_ALLOWED_CHAT_IDS=5660438838
BRIDGE_PORT=9091
BRIDGE_BEARER_TOKEN=$(openssl rand -hex 32)
TMUX_SOCKET=tgbridge-<agent>
TMUX_SESSION=<agent>
CLAUDE_BINARY=/home/Izik/.local/bin/claude
WORKSPACE=/home/Izik/.claude-lab/<agent>/.claude
STATE_DIR=/home/Izik/.claude-lab/<agent>/.claude/tg-bridge/state
LOG_DIR=/home/Izik/.claude-lab/<agent>/.claude/tg-bridge/logs
EOF
echo -n "$BRIDGE_BEARER_TOKEN" > ~/.claude-lab/<agent>/.claude/tg-bridge/state/.bearer

# 2. Patch claude settings with hooks
bash scripts/install-hooks.sh \
  --settings ~/.claude-lab/<agent>/.claude/.claude/settings.json \
  --port 9091 \
  --token-file ~/.claude-lab/<agent>/.claude/tg-bridge/state/.bearer

# 3. Start
sudo cp deploy/tg-bridge@.service deploy/tg-bridge.target /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now tg-bridge@<agent>.service
```

## Required env (validated by zod)

| Var | Default | Notes |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | — | Bot API token |
| `TELEGRAM_BOT_ID` | — | Numeric ID (must match the token's bot) |
| `TELEGRAM_ALLOWED_USER_IDS` | — | CSV |
| `TELEGRAM_ALLOWED_CHAT_IDS` | — | CSV |
| `BRIDGE_HOST` | `127.0.0.1` | |
| `BRIDGE_PORT` | — | per-agent unique |
| `BRIDGE_BEARER_TOKEN` | — | for the local `/hooks/*` endpoints |
| `TMUX_SOCKET`, `TMUX_SESSION` | — | `tgbridge-<agent>` / `<agent>` |
| `CLAUDE_BINARY`, `CLAUDE_FLAGS` | … / `--dangerously-skip-permissions` | |
| `WORKSPACE` | — | claude `-c` cwd |
| `STATE_DIR`, `LOG_DIR` | — | per-agent |
| `BUSINESS_API_ENABLED` | `false` | strictBool — `"false"` parses correctly |
| `INJECT_SENDER_IDENTITY` | `false` | strictBool |
| `OWNER_USER_IDS` | falls back to `ALLOWED_USER_IDS` | who can answer permission prompts |
| `PERMISSION_TIMEOUT_MS` | `50000` | fits Claude Code's ~60s hook window |
| `PERMISSION_DEFAULT` | `deny` | when operator doesn't answer in time |
| `QUEUE_MAX_DEPTH` | `100` | drops oldest on overflow |
| `BUSY_TIMEOUT_MS` | `180000` | force-IDLE escape hatch (3 min — gbrain MCP recall margin) |

## Development

```bash
bun install
bun test
bun run typecheck
bun run start
```

Tests: `tests/**/*.test.ts` — pure logic units (config, FSM, queue, parser, chunker, gate, policy, relay, tracker, post-tool, stop, http-server). Integration test for tmux-session takes ~3s.

## Caveats

- One operator per agent (the FSM serialises turns). The `lastInbound` map is keyed by chat_id so multi-chat works, but in-flight turns are global.
- Telegram reactions: only the bot reaction whitelist (👍 ❤ 🔥 👀 🙏 …) renders. `✅ ❌ ⚠` return `REACTION_INVALID` — use slugs that map to allowed emojis.
- The progress message can't be edited after Telegram's 48-hour edit window. Not an issue for normal turns (seconds), but if a process hangs longer, the final `done` edit fails silently.
- PostToolUse fires once per tool — subagent (Task) internals are invisible (the parent gets a single "task X done" line). The old gateway saw subagent tool_use blocks because it parsed `claude -p stream-json`; here we'd need a separate transcript follower.

## License

Apache-2.0
