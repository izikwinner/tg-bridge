#!/usr/bin/env bash
# Patch agent settings.json with tg-bridge hooks.
# Idempotent — re-running replaces our markers.
# Usage: install-hooks.sh --settings PATH --port PORT --token-file PATH
set -euo pipefail

SETTINGS=""
PORT=""
TOKEN_FILE=""

while [ $# -gt 0 ]; do
  case "$1" in
    --settings) SETTINGS="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --token-file) TOKEN_FILE="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 1 ;;
  esac
done

test -n "$SETTINGS" -a -n "$PORT" -a -n "$TOKEN_FILE" || {
  echo "usage: $0 --settings PATH --port PORT --token-file PATH" >&2; exit 1
}
test -f "$TOKEN_FILE" || { echo "token file not found: $TOKEN_FILE" >&2; exit 1; }

[ -f "$SETTINGS" ] || echo '{}' > "$SETTINGS"

HOOK_CMD_STOP="TG_BRIDGE_URL=http://127.0.0.1:${PORT}/hooks/stop TG_BRIDGE_TOKEN_FILE=${TOKEN_FILE} bun /opt/tg-bridge/scripts/hook-post.ts"
HOOK_CMD_PRE="TG_BRIDGE_URL=http://127.0.0.1:${PORT}/hooks/pretool TG_BRIDGE_TOKEN_FILE=${TOKEN_FILE} bun /opt/tg-bridge/scripts/hook-post.ts"

python3 <<PY
import json, sys
p = "$SETTINGS"
with open(p) as f: cfg = json.load(f)
hooks = cfg.setdefault("hooks", {})

def replace(name, command):
    entries = hooks.setdefault(name, [])
    entries[:] = [e for e in entries if e.get("marker") != "tg-bridge-hook"]
    entries.append({
        "marker": "tg-bridge-hook",
        "hooks": [{"type": "command", "command": command}]
    })

replace("Stop", "$HOOK_CMD_STOP")
replace("PreToolUse", "$HOOK_CMD_PRE")
with open(p, "w") as f: json.dump(cfg, f, indent=2)
print(f"install-hooks.sh: patched {p}")
PY
