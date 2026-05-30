import { loadConfig } from './config.js'
import { createLogger } from './log.js'
import { createFsm, ClaudeState } from './claude/state.js'
import { createQueue } from './claude/queue.js'
import { createTmuxSession } from './claude/tmux-session.js'
import { createBot } from './telegram/bot.js'
import { allowMessage } from './telegram/gate.js'
import { injectSenderPrefix } from './persona/sender-prefix.js'
import { parseReply } from './reply/parser.js'
import { startHttpServer } from './hooks/http-server.js'
import { handleStopHook } from './hooks/stop.js'
import { ProgressTracker } from './progress/tracker.js'
import { createRelay } from './permission/relay.js'
import { needsRelay, type Policy } from './permission/policy.js'
import { mkdirSync, existsSync, readFileSync } from 'fs'
import { load as loadYaml } from 'js-yaml'
import { join } from 'path'

const cfg = loadConfig(process.env)

mkdirSync(cfg.paths.state_dir, { recursive: true })
mkdirSync(cfg.paths.log_dir, { recursive: true })

const log = createLogger({
  secrets: [cfg.telegram.bot_token, cfg.bridge.bearer_token],
})

log.info('starting', { agent: cfg.claude.tmux_session, port: cfg.bridge.port })

const policyPath = join(cfg.paths.state_dir, '..', 'permission-policy.yaml')
let policy: Policy = { relay_patterns: [], default: 'allow' }
if (existsSync(policyPath)) {
  policy = loadYaml(readFileSync(policyPath, 'utf8')) as Policy
}

const fsm = createFsm()
const queue = createQueue<{ chat_id: number; user_id: number; text: string; message_id: number }>({
  maxDepth: cfg.limits.queue_max_depth,
})

const tmux = createTmuxSession({
  socket: cfg.claude.tmux_socket,
  session: cfg.claude.tmux_session,
  cwd: cfg.claude.workspace,
  command: `${cfg.claude.binary} ${cfg.claude.flags}`,
})

await tmux.ensure()
log.info('tmux session ready')

const bot = createBot(cfg.telegram.bot_token, log)

const lastInbound = new Map<number, number>()

interface ActiveTurn {
  chatId: number
  tracker: ProgressTracker
  progressMsgId: number | null
  pendingEdit: boolean
  lastEditMs: number
  tickHandle: ReturnType<typeof setInterval> | null
}
let active: ActiveTurn | null = null

const EDIT_MIN_GAP_MS = 1200
const TICK_INTERVAL_MS = 5000

const scheduleEdit = (turn: ActiveTurn): void => {
  if (turn.progressMsgId == null || turn.pendingEdit) return
  turn.pendingEdit = true
  const since = Date.now() - turn.lastEditMs
  const wait = Math.max(0, EDIT_MIN_GAP_MS - since)
  setTimeout(async () => {
    turn.pendingEdit = false
    turn.lastEditMs = Date.now()
    if (turn.progressMsgId == null) return
    await bot.editHtml(turn.chatId, turn.progressMsgId, turn.tracker.render())
  }, wait)
}

const startTurn = async (chatId: number): Promise<void> => {
  const tracker = new ProgressTracker()
  const turn: ActiveTurn = {
    chatId,
    tracker,
    progressMsgId: null,
    pendingEdit: false,
    lastEditMs: 0,
    tickHandle: null,
  }
  active = turn
  const id = await bot.sendHtml(chatId, tracker.render())
  turn.progressMsgId = id
  turn.lastEditMs = Date.now()
  turn.tickHandle = setInterval(() => scheduleEdit(turn), TICK_INTERVAL_MS)
}

const endTurn = async (finalState: 'done' = 'done'): Promise<void> => {
  if (!active) return
  const turn = active
  active = null
  if (turn.tickHandle) clearInterval(turn.tickHandle)
  if (turn.progressMsgId != null) {
    await bot.editHtml(turn.chatId, turn.progressMsgId, turn.tracker.render(finalState))
  }
}

const endTurnAndDelete = async (): Promise<void> => {
  if (!active) return
  const turn = active
  active = null
  if (turn.tickHandle) clearInterval(turn.tickHandle)
  if (turn.progressMsgId != null) {
    await bot.deleteMessage(turn.chatId, turn.progressMsgId)
  }
}

let busyTimer: ReturnType<typeof setTimeout> | null = null

const armBusyTimer = (): void => {
  if (busyTimer) clearTimeout(busyTimer)
  busyTimer = setTimeout(() => {
    busyTimer = null
    if (fsm.current() === ClaudeState.BUSY) {
      log.warn('busy timeout (no hook activity), forcing IDLE')
      void endTurn('done')
      fsm.forceIdle()
      void drain()
    }
  }, cfg.limits.busy_timeout_ms)
}

const disarmBusyTimer = (): void => {
  if (busyTimer) { clearTimeout(busyTimer); busyTimer = null }
}

const drain = async () => {
  if (fsm.current() !== ClaudeState.IDLE) return
  const next = queue.shift()
  if (!next) return
  lastInbound.set(next.chat_id, next.message_id)
  fsm.onSent()
  await startTurn(next.chat_id)
  await tmux.sendKeys(next.text)
  armBusyTimer()
}

const onTelegramMessage = async (msg: {
  from?: { id: number; username?: string; first_name?: string }
  chat: { id: number }
  text?: string
  message_id: number
}) => {
  if (!msg.from || !msg.text) return
  const gate = allowMessage(
    { from_id: msg.from.id, chat_id: msg.chat.id },
    { user_ids: cfg.telegram.allowed_user_ids, chat_ids: cfg.telegram.allowed_chat_ids },
  )
  if (gate !== 'allow') {
    log.info('denied', { reason: gate, user_id: msg.from.id })
    return
  }
  let text = msg.text
  if (cfg.features.inject_sender_identity) {
    text = injectSenderPrefix({
      text,
      user_id: msg.from.id,
      username: msg.from.username,
      first_name: msg.from.first_name,
      owner_ids: cfg.features.owner_user_ids,
    })
  }
  void bot.setReaction(msg.chat.id, msg.message_id, 'eyes').catch(() => {})
  const dropped = queue.push({
    chat_id: msg.chat.id,
    user_id: msg.from.id,
    text,
    message_id: msg.message_id,
  })
  if (dropped) log.warn('queue overflow, dropped oldest')
  await drain()
}

const ownerChatId =
  cfg.features.owner_user_ids[0] ??
  cfg.telegram.allowed_user_ids[0] ??
  0

const relay = createRelay({
  sendPrompt: async (chatId, text, reqId) => {
    await bot.raw.api.sendMessage(chatId, text, {
      reply_markup: {
        inline_keyboard: [[
          { text: 'Allow', callback_data: `perm:${reqId}:allow` },
          { text: 'Deny', callback_data: `perm:${reqId}:deny` },
        ]],
      },
    })
  },
  ownerChatId,
  timeoutMs: cfg.limits.permission_timeout_ms,
  defaultDecision: cfg.limits.permission_default,
})

const server = await startHttpServer({
  host: cfg.bridge.host,
  port: cfg.bridge.port,
  bearerToken: cfg.bridge.bearer_token,
  onGbrainPush: async (body) => {
    const b = body as { chat_id?: number; user_id?: number; text?: string }
    if (!b.chat_id || !b.user_id || !b.text) return { status: 400, body: { error: 'bad payload' } }
    log.info('gbrain push', { chat_id: b.chat_id, text_len: b.text.length })
    queue.push({ chat_id: b.chat_id, user_id: b.user_id, text: b.text, message_id: 0 })
    void drain()
    return { status: 200, body: { status: 'accepted' } }
  },
  onStop: async (body) => {
    const { assistant_message } = await handleStopHook(body as { transcript_path?: string })
    log.info('stop hook', { msg_len: assistant_message.length, chat: Array.from(lastInbound.keys()).pop() })
    const { text, reactions } = parseReply(assistant_message)
    const targetChat = Array.from(lastInbound.keys()).pop()
    const targetMsg = targetChat !== undefined ? lastInbound.get(targetChat) : undefined
    disarmBusyTimer()
    if (targetChat !== undefined && text.length > 0) {
      await endTurnAndDelete()
      await bot.sendText(targetChat, text)
      if (reactions.length === 0 && targetMsg !== undefined) {
        await bot.setReaction(targetChat, targetMsg, 'thumbsup')
      } else {
        for (const r of reactions) {
          if (targetMsg !== undefined) await bot.setReaction(targetChat, targetMsg, r)
        }
      }
    } else {
      await endTurn('done')
    }
    fsm.onStop()
    void drain()
    return { status: 200, body: { ok: true } }
  },
  onPostTool: async (body) => {
    const b = body as { tool_name?: string; tool_input?: Record<string, unknown>; tool?: string; args?: Record<string, unknown> }
    const tool = b.tool_name ?? b.tool
    const args = b.tool_input ?? b.args ?? {}
    if (!tool) return { status: 200, body: { ok: true } }
    armBusyTimer()
    if (!active) return { status: 200, body: { ok: true } }
    active.tracker.onTool(tool, args)
    scheduleEdit(active)
    return { status: 200, body: { ok: true } }
  },
  onPreTool: async (body) => {
    const b = body as {
      tool_name?: string
      tool_input?: Record<string, unknown>
      tool?: string
      args?: Record<string, unknown>
    }
    const toolName = b.tool_name ?? b.tool
    const toolArgs = b.tool_input ?? b.args ?? {}
    if (!toolName) {
      return {
        status: 200,
        body: {
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'allow',
            permissionDecisionReason: 'no tool name; passthrough',
          },
        },
      }
    }
    armBusyTimer()
    const inv = { tool: toolName, args: toolArgs }
    log.info('pretool', { tool: toolName, relay: needsRelay(inv, policy) })
    if (!needsRelay(inv, policy)) {
      return {
        status: 200,
        body: {
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'allow',
            permissionDecisionReason: 'policy: passthrough',
          },
        },
      }
    }
    if (fsm.current() === ClaudeState.BUSY) fsm.onPreTool()
    const verdict = await relay.requestVerdict(inv)
    if (fsm.current() === ClaudeState.WAITING_PERMISSION) fsm.onPermissionVerdict()
    return {
      status: 200,
      body: {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: verdict,
          permissionDecisionReason: `tg-bridge relay verdict: ${verdict}`,
        },
      },
    }
  },
})

log.info('http listening', { port: server.port })

await bot.start(async (update) => {
  const u = update as {
    message?: Parameters<typeof onTelegramMessage>[0]
    callback_query?: { data?: string; from: { id: number } }
  }
  if (u.message) await onTelegramMessage(u.message)
  if (u.callback_query?.data) {
    const m = u.callback_query.data.match(/^perm:([0-9a-f-]+):(allow|deny)$/)
    if (m && cfg.features.owner_user_ids.includes(u.callback_query.from.id)) {
      const reqId = m[1]
      const decision = m[2] as 'allow' | 'deny'
      if (reqId) relay.callbackAnswer(reqId, decision)
    }
  }
})

log.info('bot polling started', { bot_id: cfg.telegram.bot_id })

const shutdown = async () => {
  log.info('shutting down')
  await bot.stop()
  await server.stop()
  process.exit(0)
}
process.on('SIGTERM', () => void shutdown())
process.on('SIGINT', () => void shutdown())
