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

### Inbound (operator → agent)

- **Text** — straight pass-through (with optional `[Operator/<id>]` persona prefix)
- **Voice / audio** — downloaded, transcribed with [Groq Whisper](https://groq.com) (`whisper-large-v3`), transcript injected as text. Telegram `.oga` files are renamed to `.ogg` so Groq accepts them. Requires `GROQ_API_KEY_FILE`.
- **Document / photo / video** — saved to `<workspace>/.tg-uploads/<UTC-ts>-<safe-name>`, then injected as `Operator fayl yubordi: <path>` (caption appended if present). The agent reads the file with its own `Read` tool.
- **Allow-list gate** — drops anything not from configured `TELEGRAM_ALLOWED_USER_IDS` / `TELEGRAM_ALLOWED_CHAT_IDS`.

### Live progress (agent → operator)

- **Receipt reaction** — 👀 on the operator's message as soon as it's accepted
- **Edit-in-place** — single `<pre>working — Xs … ▸ [B] bash git status</pre>` message updated as tool calls fire (PostToolUse hook). Deleted after Stop when a non-empty reply is delivered.
- **Tool tags** — `[R]ead [W]rite [B]ash [G]rep [F]etch [S]earch [A]gent [T]odoWrite`. Last 5 shown; older collapsed to `... +N earlier`. Each detail line is run through `mask_secrets` (IPv4, tokens, supabase URLs, secret paths).
- **TodoWrite plan** — when the agent uses `TodoWrite`, the plan renders as a Unicode progress bar (`▰▰▰▱▱▱▱ 50%`) with x / > / blank markers.
- **Subagent tracking** — `Task` tool dispatches appear in an `agents:` section. PreToolUse marks them `> running`, PostToolUse flips to `x done`.
- **Streaming modes** — `STREAMING_MODE=off|partial|progress` per agent. `off` skips the progress message entirely (only final reply); `partial` shows the message but no tool tracking; `progress` (default) is full live.
- **Done reaction** — 👍 (or whatever the assistant emits via `[REACT:slug]`) on the original message after Stop.

### Outbound widgets

- **Inline buttons** — agent ends a reply with `[BUTTONS: Ha=yes | Yo'q=no | Boshqa=other]`. Bridge sends the reply with an inline keyboard. Clicking a button delivers the payload back to the agent as a new turn (FIFO-queued, FSM-gated). Common labels (`Ha`, `Yes`, `Yo'q`, `No`, `Cancel`, …) auto-decorate with ✅ / ❌; labels already starting with an emoji are left as-is. Up to 8 buttons; payload ≤59 bytes (Telegram `callback_data` 64-byte limit minus `abtn:` prefix).
- **Permission relay** — PreToolUse hook can prompt the operator with Allow/Deny inline buttons for sensitive tools (configurable via `permission-policy.yaml`).

### Plumbing

- **gbrain swarm ingress** — `POST /hooks/agent` accepts cross-agent pushes from the gbrain swarm-worker.
- **FSM-gated queue** — IDLE / BUSY / WAITING_PERMISSION; messages received during BUSY are queued in FIFO order.
- **Heartbeat-based busy timeout** — `BUSY_TIMEOUT_MS` (default 300s) is reset on every PreToolUse, PostToolUse, and every 30s if the tmux pane content changed. Force-IDLE only fires on genuine multi-minute silence.
- **Paste-safe sendKeys** — text is sent with `tmux send-keys -l`, then a 150ms delay, then `Enter` as a separate call. Without the delay, Claude Code's paste detection swallows the submit on long inputs (file paths, multi-line text).

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
  progress/
    tracker.ts              edit-in-place ProgressTracker (current progress UI)
  permission/
    policy.ts               YAML pattern matcher (which tools need operator confirmation)
    relay.ts                inline-button Allow/Deny round-trip
  reply/
    parser.ts               extracts `[REACT:slug]` and `[BUTTONS:…]` markers
    sender.ts               Telegram message chunking (4096-byte limit)
  voice/
    groq.ts                 Groq Whisper transcription
  telegram/
    file.ts                 Telegram getFile + download (.oga → .ogg rename)
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
| `BUSY_TIMEOUT_MS` | `300000` | force-IDLE escape hatch (5 min). Reset on every PreToolUse/PostToolUse and every 30s if tmux pane content changed. |
| `STREAMING_MODE` | `progress` | `off` / `partial` / `progress` |
| `GROQ_API_KEY_FILE` | _(unset)_ | path to a file containing the Groq API key. When unset, voice/audio messages are dropped. |

## Development

```bash
bun install
bun test
bun run typecheck
bun run start
```

Tests: `tests/**/*.test.ts` — pure logic units (config, FSM, queue, parser, chunker, gate, policy, relay, tracker, mask, stop, http-server). Integration test for tmux-session takes ~3s.

## Markers the agent can emit

The bridge scans the assistant's final reply line-by-line for end-of-line markers and strips them out before sending the text to the operator.

| Marker | Effect |
|---|---|
| `[REACT:thumbsup]` | Sets a reaction on the operator's original message. Slug is mapped via `EMOJI_MAP` (`thumbsup`, `thumbsdown`, `heart`, `fire`, `eyes`, `hundred`, `clap`, `pray`, `ok`). Multiple markers stack. |
| `[BUTTONS: Ha=yes \| Yo'q=no \| Boshqa]` | Sends the reply with an inline keyboard. `Label=payload` syntax; bare label uses itself as payload. Up to 8 buttons. |

## Caveats

- One operator per agent (the FSM serialises turns). The `lastInbound` map is keyed by chat_id so multi-chat works, but in-flight turns are global.
- Telegram reactions: only the bot reaction whitelist (👍 ❤ 🔥 👀 🙏 …) renders. `✅ ❌ ⚠` return `REACTION_INVALID` — use slugs that map to allowed emojis.
- The progress message can't be edited after Telegram's 48-hour edit window. Not an issue for normal turns (seconds), but if a process hangs longer, the final `done` edit fails silently.
- Subagent (Task) **internals** are still invisible — we track only the parent dispatch via PreToolUse/PostToolUse. The old gateway saw subagent `tool_use` blocks because it parsed `claude -p stream-json`; here we'd need a separate transcript follower.
- Voice transcription uses `whisper-large-v3` at Groq. Cost per minute is in the cents range, but every voice message hits the API — disable by leaving `GROQ_API_KEY_FILE` unset if not needed.
- Uploaded files are NOT garbage-collected. `<workspace>/.tg-uploads/` grows over time; clean periodically.

## License

Apache-2.0
