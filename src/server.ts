import { loadConfig } from './config.js'
import { createLogger } from './log.js'
import { createFsm, ClaudeState } from './claude/state.js'
import { createQueue } from './claude/queue.js'
import { createTmuxSession } from './claude/tmux-session.js'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { loadOrCreateSid, buildClaudeCommand, latestTranscriptSid } from './claude/session-id.js'
import { createBot } from './telegram/bot.js'
import { allowMessage } from './telegram/gate.js'
import { injectSenderPrefix } from './persona/sender-prefix.js'
import { parseReply } from './reply/parser.js'
import { formatReplyHtml } from './reply/markdown.js'
import { startHttpServer } from './hooks/http-server.js'
import { handleStopHook } from './hooks/stop.js'
import { ProgressTracker } from './progress/tracker.js'
import { transcribeAudio, loadGroqKey } from './voice/groq.js'
import { downloadTelegramFile } from './telegram/file.js'
import { cleanupUploads } from './uploads/cleanup.js'
import { getSql, closeSql, loadDsn, type Sql } from './db/pool.js'
import { insertChatLog } from './db/chat_log.js'
import { upsertAgentState } from './db/agent_state.js'
import { writeFileSync } from 'fs'
import { basename } from 'path'
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

const dsn = cfg.db.dsn_file ? loadDsn(cfg.db.dsn_file) : null
const sql: Sql | null = dsn ? getSql({ dsn, agent: cfg.db.agent_name, logger: log }) : null
if (sql) log.info('db enabled', { agent: cfg.db.agent_name })
else log.info('db disabled', { reason: cfg.db.dsn_file ? 'dsn-missing' : 'no-dsn-file' })

const dbInsertIn = async (channel: QueueChannel, text: string, meta: Record<string, unknown>): Promise<void> => {
  if (!sql) return
  await insertChatLog(sql, log, { agent: cfg.db.agent_name, channel, direction: 'in', text, meta })
}
const dbInsertOut = async (channel: QueueChannel, text: string, meta: Record<string, unknown>): Promise<void> => {
  if (!sql) return
  await insertChatLog(sql, log, { agent: cfg.db.agent_name, channel, direction: 'out', text, meta })
}
const dbSetWorking = async (task: string | null): Promise<void> => {
  if (!sql) return
  await upsertAgentState(sql, log, { agent: cfg.db.agent_name, status: 'working', currentTask: task ?? null })
}
const dbSetIdle = async (): Promise<void> => {
  if (!sql) return
  await upsertAgentState(sql, log, { agent: cfg.db.agent_name, status: 'idle', currentTask: null, progressHtml: null })
}

const policyPath = join(cfg.paths.state_dir, '..', 'permission-policy.yaml')
let policy: Policy = { relay_patterns: [], default: 'allow' }
if (existsSync(policyPath)) {
  policy = loadYaml(readFileSync(policyPath, 'utf8')) as Policy
}

const fsm = createFsm()

type QueueChannel = 'telegram' | 'web' | 'swarm'
interface QueueItem {
  chat_id: number
  user_id: number
  text: string
  message_id: number
  channel: QueueChannel
  web_session_id?: string
}
const queue = createQueue<QueueItem>({
  maxDepth: cfg.limits.queue_max_depth,
})

// Stable session id persisted on disk → resume the same conversation across
// reboot / hardRestart instead of starting fresh (gateway.py's durable-resume).
// On first run (no sid file yet) adopt the workspace's most recent transcript
// so the conversation that is already live survives the first respawn too.
const claudeHome = process.env.HOME ?? homedir()
const claudeSid = loadOrCreateSid(
  cfg.paths.state_dir,
  () => latestTranscriptSid(claudeHome, cfg.claude.workspace) ?? randomUUID(),
)
log.info('claude session id', { sid: claudeSid })
const tmux = createTmuxSession({
  socket: cfg.claude.tmux_socket,
  session: cfg.claude.tmux_session,
  cwd: cfg.claude.workspace,
  buildCommand: () =>
    buildClaudeCommand({
      binary: cfg.claude.binary,
      flags: cfg.claude.flags,
      workspace: cfg.claude.workspace,
      sid: claudeSid,
      home: claudeHome,
    }),
})

await tmux.ensure()
log.info('tmux session ready')

const bot = createBot(cfg.telegram.bot_token, log)

interface InboundOrigin {
  message_id: number
  channel: QueueChannel
  web_session_id?: string
}
const lastInbound = new Map<number, InboundOrigin>()

interface ActiveTurn {
  chatId: number
  channel: QueueChannel
  webSessionId?: string
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

const startTurn = async (chatId: number, channel: QueueChannel = 'telegram', webSessionId?: string): Promise<void> => {
  if (cfg.streaming.mode === 'off') return
  const tracker = new ProgressTracker()
  const turn: ActiveTurn = {
    chatId,
    channel,
    tracker,
    progressMsgId: null,
    pendingEdit: false,
    lastEditMs: 0,
    tickHandle: null,
  }
  if (webSessionId) turn.webSessionId = webSessionId
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
let paneWatcher: ReturnType<typeof setInterval> | null = null
let typingPulse: ReturnType<typeof setInterval> | null = null
let typingChat: number | null = null
let lastPaneFingerprint = ''

// Tools where Claude pauses for human input (AskUserQuestion modal, plan-mode
// approval). While one is pending, no hook fires and the tmux pane only shows
// the modal — so the busy timer would force-IDLE while Claude is genuinely
// alive and waiting for the operator. We freeze the heartbeat for these.
const AWAITING_USER_TOOLS = new Set(['AskUserQuestion', 'ExitPlanMode'])
let awaitingUserTool: string | null = null

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function renderAwaitingUserPrompt(tool: string, args: Record<string, unknown>): string | null {
  if (tool === 'AskUserQuestion') {
    const questions = Array.isArray((args as { questions?: unknown }).questions)
      ? (args as { questions: Array<Record<string, unknown>> }).questions
      : []
    if (questions.length === 0) return null
    const lines: string[] = ['<b>❓ Agent savol berdi:</b>', '']
    for (const q of questions) {
      const qText = typeof q.question === 'string' ? q.question : ''
      if (qText) lines.push(escapeHtml(qText))
      const opts = Array.isArray(q.options) ? q.options as Array<Record<string, unknown>> : []
      for (let i = 0; i < opts.length; i++) {
        const o = opts[i]!
        const label = typeof o.label === 'string' ? o.label : `option ${i + 1}`
        const desc = typeof o.description === 'string' ? ` — ${o.description}` : ''
        lines.push(`  ${i + 1}. <b>${escapeHtml(label)}</b>${escapeHtml(desc)}`)
      }
      lines.push('')
    }
    lines.push("<i>Javobni shu chatga oddiy matn bilan yozing — Claude modal'iga uzatiladi.</i>")
    return lines.join('\n')
  }
  if (tool === 'ExitPlanMode') {
    const plan = typeof (args as { plan?: unknown }).plan === 'string'
      ? (args as { plan: string }).plan
      : ''
    const head = "<b>📋 Agent rejani tasdiqlash so'rayapti:</b>\n\n"
    const body = plan ? `<pre>${escapeHtml(plan)}</pre>\n\n` : ''
    return head + body + "<i>Tasdiqlash: \"ha\" deb yozing yoki o'zgartirish kerakli matnni yuboring.</i>"
  }
  return null
}

const TYPING_TICK_MS = 4000

const startTyping = (chatId: number): void => {
  typingChat = chatId
  void bot.sendChatAction(chatId, 'typing')
  if (typingPulse) clearInterval(typingPulse)
  typingPulse = setInterval(() => {
    if (typingChat !== null) void bot.sendChatAction(typingChat, 'typing')
  }, TYPING_TICK_MS)
}

const stopTyping = (): void => {
  if (typingPulse) { clearInterval(typingPulse); typingPulse = null }
  typingChat = null
}

const PANE_TICK_MS = 30000

const paneFingerprint = (s: string): string => {
  const lines = s.replace(/[ \t]+$/gm, '').split('\n')
  return lines.slice(-60).join('\n')
}

const armBusyTimer = (): void => {
  if (busyTimer) clearTimeout(busyTimer)
  busyTimer = setTimeout(() => {
    busyTimer = null
    if (fsm.current() === ClaudeState.BUSY) {
      log.warn('busy timeout (no activity), forcing IDLE')
      stopPaneWatcher()
      stopMirror()
      void endTurn('done')
      fsm.forceIdle()
      void drain()
    }
  }, cfg.limits.busy_timeout_ms)
}

const disarmBusyTimer = (): void => {
  if (busyTimer) { clearTimeout(busyTimer); busyTimer = null }
}

const startPaneWatcher = (): void => {
  if (paneWatcher) return
  lastPaneFingerprint = ''
  paneWatcher = setInterval(() => {
    void (async () => {
      try {
        const pane = await tmux.capturePane()
        const fp = paneFingerprint(pane)
        if (fp !== lastPaneFingerprint) {
          lastPaneFingerprint = fp
          armBusyTimer()
        }
      } catch (err) {
        log.warn('capturePane failed', { error: String(err) })
      }
    })()
  }, PANE_TICK_MS)
}

const stopPaneWatcher = (): void => {
  if (paneWatcher) { clearInterval(paneWatcher); paneWatcher = null; lastPaneFingerprint = '' }
}

// ── Live terminal mirror ─────────────────────────────────────────────────────
// During a long/stuck turn, edit a single Telegram message every interval with
// the latest screen of the tmux pane (last N lines only — old lines drop off so
// the message never grows past Telegram's 4096-char cap). A delayed start keeps
// short turns clean; a stale marker flags a frozen/wedged session.
let mirrorTimer: ReturnType<typeof setInterval> | null = null
let mirrorStartTimer: ReturnType<typeof setTimeout> | null = null
let mirrorMsgId: number | null = null
let mirrorChat: number | null = null
let mirrorLastBody = ''
let mirrorLastChangeMs = 0
let mirrorLastSentHtml = ''

const MIRROR_HARD_CAP = 3500
const MIRROR_STALE_MS = 90000

const formatMirror = (pane: string, stale: boolean): string => {
  let lines = pane.split('\n').map((l) => l.replace(/[ \t]+$/, ''))
  while (lines.length && lines[lines.length - 1] === '') lines.pop()
  while (lines.length && lines[0] === '') lines.shift()
  if (lines.length > cfg.mirror.max_lines) lines = lines.slice(-cfg.mirror.max_lines)
  let body = lines.join('\n')
  while (body.length > MIRROR_HARD_CAP && lines.length > 1) {
    lines.shift()
    body = lines.join('\n')
  }
  if (body.length > MIRROR_HARD_CAP) body = body.slice(-MIRROR_HARD_CAP)
  const name = escapeHtml(cfg.claude.tmux_session)
  const head = stale
    ? `🖥 <b>${name}</b> — ⚠️ qotgan bo'lishi mumkin · <code>/new</code> bilan tikla`
    : `🖥 <b>${name}</b> — terminal (jonli)`
  return `${head}\n<pre>${escapeHtml(body) || "(bo'sh)"}</pre>`
}

const renderMirrorTick = async (): Promise<void> => {
  if (mirrorChat === null) return
  let pane: string
  try { pane = await tmux.capturePane() } catch { return }
  const bodyKey = pane.replace(/[ \t]+$/gm, '')
  const now = Date.now()
  if (bodyKey !== mirrorLastBody) { mirrorLastBody = bodyKey; mirrorLastChangeMs = now }
  const stale = now - mirrorLastChangeMs >= MIRROR_STALE_MS
  const html = formatMirror(pane, stale)
  if (html === mirrorLastSentHtml) return
  try {
    if (mirrorMsgId === null) {
      mirrorMsgId = await bot.sendHtml(mirrorChat, html)
    } else {
      await bot.editHtml(mirrorChat, mirrorMsgId, html)
    }
    mirrorLastSentHtml = html
  } catch (err) {
    log.warn('mirror update failed', { error: String(err) })
  }
}

const startMirror = (chatId: number): void => {
  if (!cfg.mirror.enabled) return
  stopMirror()
  mirrorChat = chatId
  mirrorLastBody = ''
  mirrorLastChangeMs = Date.now()
  mirrorLastSentHtml = ''
  mirrorStartTimer = setTimeout(() => {
    mirrorStartTimer = null
    void renderMirrorTick()
    mirrorTimer = setInterval(() => void renderMirrorTick(), cfg.mirror.interval_ms)
  }, cfg.mirror.start_delay_ms)
}

function stopMirror(): void {
  if (mirrorStartTimer) { clearTimeout(mirrorStartTimer); mirrorStartTimer = null }
  if (mirrorTimer) { clearInterval(mirrorTimer); mirrorTimer = null }
  const chat = mirrorChat
  const msg = mirrorMsgId
  mirrorChat = null
  mirrorMsgId = null
  mirrorLastBody = ''
  mirrorLastSentHtml = ''
  if (chat !== null && msg !== null) void bot.deleteMessage(chat, msg).catch(() => {})
}

const drain = async () => {
  if (fsm.current() !== ClaudeState.IDLE) return
  const next = queue.shift()
  if (!next) return
  const origin: InboundOrigin = { message_id: next.message_id, channel: next.channel }
  if (next.web_session_id) origin.web_session_id = next.web_session_id
  lastInbound.set(next.chat_id, origin)
  fsm.onSent()
  const inMeta: Record<string, unknown> = { chat_id: next.chat_id, user_id: next.user_id }
  if (next.channel === 'telegram') inMeta.tg_message_id = next.message_id
  if (next.web_session_id) inMeta.web_session_id = next.web_session_id
  void dbInsertIn(next.channel, next.text, inMeta)
  void dbSetWorking(next.text.slice(0, 120))
  await startTurn(next.chat_id, next.channel, next.web_session_id)
  if (next.channel === 'telegram') startTyping(next.chat_id)
  await tmux.sendKeys(next.text)
  armBusyTimer()
  startPaneWatcher()
  startMirror(next.chat_id)
}

const uploadsDir = join(cfg.claude.workspace, '.tg-uploads')
mkdirSync(uploadsDir, { recursive: true })

const startedAtMs = Date.now()

const runCleanup = (): void => {
  if (cfg.uploads.ttl_days <= 0) return
  const r = cleanupUploads(uploadsDir, cfg.uploads.ttl_days * 24 * 60 * 60 * 1000)
  if (r.removed > 0) {
    log.info('uploads cleanup', { removed: r.removed, kept: r.kept, freedBytes: r.freedBytes })
  }
}
runCleanup()
setInterval(runCleanup, 24 * 60 * 60 * 1000)

function safeFilename(name: string): string {
  const b = basename(name)
  return b.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 120) || 'file'
}

function tsPrefix(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`
}

const saveIfFile = async (msg: {
  document?: { file_id: string; file_name?: string }
  photo?: Array<{ file_id: string; file_size?: number }>
  video?: { file_id: string; file_name?: string }
}): Promise<string | null> => {
  const file = msg.document
    ?? msg.video
    ?? (msg.photo && msg.photo.length > 0 ? msg.photo[msg.photo.length - 1] : undefined)
  if (!file) return null
  try {
    const { buf, filename } = await downloadTelegramFile(cfg.telegram.bot_token, file.file_id)
    const hint = (msg.document?.file_name ?? msg.video?.file_name ?? filename)
    const name = safeFilename(hint)
    const savePath = join(uploadsDir, `${tsPrefix()}-${name}`)
    writeFileSync(savePath, Buffer.from(buf))
    log.info('file saved', { path: savePath, bytes: buf.byteLength })
    return savePath
  } catch (err) {
    log.warn('file save failed', { error: String(err) })
    return null
  }
}

const formatUptime = (ms: number): string => {
  const s = Math.floor(ms / 1000)
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (d > 0) return `${d}d ${h}h ${m}m`
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${sec}s`
  return `${sec}s`
}

const renderStatus = (): string => {
  const uptime = formatUptime(Date.now() - startedAtMs)
  const state = fsm.current()
  const qd = queue.size()
  const activeChat = active?.chatId ?? null
  const activeElapsed = active ? active.tracker.elapsedSec() : null
  const lines = [
    `tg-bridge @ ${cfg.claude.tmux_session}`,
    `uptime  ${uptime}`,
    `state   ${state}`,
    `queue   ${qd}`,
    `streaming ${cfg.streaming.mode}`,
    activeChat !== null ? `turn    chat=${activeChat} elapsed=${activeElapsed}s` : 'turn    -',
  ]
  return `<pre>${lines.join('\n')}</pre>`
}

const transcribeIfVoice = async (msg: {
  voice?: { file_id: string; duration?: number }
  audio?: { file_id: string }
}): Promise<string | null> => {
  const fileId = msg.voice?.file_id ?? msg.audio?.file_id
  if (!fileId) return null
  if (!cfg.voice.groq_api_key_file) {
    log.warn('voice received but GROQ_API_KEY_FILE unset')
    return null
  }
  try {
    const key = loadGroqKey(cfg.voice.groq_api_key_file)
    const { buf, filename } = await downloadTelegramFile(cfg.telegram.bot_token, fileId)
    const mime = filename.endsWith('.ogg') || filename.endsWith('.oga')
      ? 'audio/ogg'
      : 'audio/mpeg'
    const text = await transcribeAudio({ apiKey: key, audio: buf, filename, mimeType: mime })
    log.info('voice transcribed', { len: text.length })
    return text
  } catch (err) {
    log.warn('voice transcription failed', { error: String(err) })
    return null
  }
}

const onTelegramMessage = async (msg: {
  from?: { id: number; username?: string; first_name?: string }
  chat: { id: number }
  text?: string
  caption?: string
  voice?: { file_id: string; duration?: number }
  audio?: { file_id: string }
  document?: { file_id: string; file_name?: string }
  photo?: Array<{ file_id: string; file_size?: number }>
  video?: { file_id: string; file_name?: string }
  message_id: number
}) => {
  if (!msg.from) return
  const gate = allowMessage(
    { from_id: msg.from.id, chat_id: msg.chat.id },
    { user_ids: cfg.telegram.allowed_user_ids, chat_ids: cfg.telegram.allowed_chat_ids },
  )
  if (gate !== 'allow') {
    log.info('denied', { reason: gate, user_id: msg.from.id })
    return
  }
  const cmd = (msg.text ?? '').trim().toLowerCase()
  if (cmd === '/status') {
    await bot.sendHtml(msg.chat.id, renderStatus())
    return
  }
  // Bridge control commands. These must be handled here (not forwarded into the
  // pane) because when the TUI is wedged, send-keys into Claude is ignored.
  if (cmd === '/stop') {
    // Soft interrupt: Escape into the pane + reset bridge turn state to IDLE so
    // the next message can drain. If the input loop is wedged, use /new instead.
    disarmBusyTimer()
    stopPaneWatcher()
    stopMirror()
    stopTyping()
    awaitingUserTool = null
    await tmux.sendEscape().catch(() => {})
    await endTurn('done')
    fsm.forceIdle()
    void dbSetIdle()
    await bot.sendHtml(msg.chat.id, "⏹ Escape yuborildi, holat IDLE. Agar qotib qolsa — <code>/new</code> hard restart qiladi.")
    void drain()
    return
  }
  if (cmd === '/new' || cmd === '/reset' || cmd === '/clear' || cmd === '/kill') {
    // Hard restart: kill + respawn the Claude process and wipe all bridge state.
    // Works even when the TUI input loop is dead (the failure mode where typed
    // /stop and /clear are silently ignored).
    disarmBusyTimer()
    stopPaneWatcher()
    stopMirror()
    stopTyping()
    awaitingUserTool = null
    await endTurnAndDelete()
    while (queue.shift()) { /* drain pending */ }
    fsm.forceIdle()
    void dbSetIdle()
    try {
      await tmux.hardRestart()
      await bot.sendHtml(msg.chat.id, "🔄 Claude sessiyasi qayta ishga tushirildi (toza kontekst).")
    } catch (err) {
      log.warn('hard restart failed', { error: String(err) })
      await bot.sendHtml(msg.chat.id, "⚠️ restart xato: " + escapeHtml(String(err)))
    }
    return
  }
  let text = msg.text ?? msg.caption ?? ''
  const savedPath = await saveIfFile(msg)
  if (savedPath) {
    const prefix = `Operator fayl yubordi: ${savedPath}`
    text = text ? `${prefix}\n${text}` : prefix
  }
  if (!text) {
    const transcript = await transcribeIfVoice(msg)
    if (transcript) text = transcript
  }
  if (!text) return
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
  // If Claude is sitting in an AskUserQuestion / ExitPlanMode modal, the FSM
  // is BUSY and queue.push won't drain. Route the operator's text straight
  // into the tmux pane so the modal consumes it as the answer.
  if (awaitingUserTool) {
    log.info('routing message into active modal', { tool: awaitingUserTool, text_len: text.length })
    await tmux.sendKeys(text)
    return
  }
  const dropped = queue.push({
    chat_id: msg.chat.id,
    user_id: msg.from.id,
    text,
    message_id: msg.message_id,
    channel: 'telegram',
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
    const b = body as {
      chat_id?: number; user_id?: number; text?: string
      chatId?: number; message?: string
      agentId?: string; from_agent?: string
      channel?: string; web_session_id?: string
      attachments?: Array<{ path?: string; name?: string; kind?: string }>
    }
    const chat_id = b.chat_id ?? b.chatId ?? cfg.features.owner_user_ids[0]
    let text = b.text ?? b.message ?? ''
    if (Array.isArray(b.attachments) && b.attachments.length > 0) {
      const lines = b.attachments
        .filter((a) => a && typeof a.path === 'string' && a.path.length > 0)
        .map((a) => `Operator fayl yubordi: ${a.path}`)
      if (lines.length > 0) text = (text ? text + '\n' : '') + lines.join('\n')
    }
    // Infer channel: explicit `channel` wins; else agentId/from_agent ⇒ swarm push;
    // else default to telegram. Swarm pushes don't have a Telegram user_id —
    // fall back to chat_id (owner's id == chat_id in personal chats).
    const rawChannel = (b.channel ?? (b.agentId || b.from_agent ? 'swarm' : 'telegram')).toLowerCase()
    const channel: QueueChannel =
      rawChannel === 'web' || rawChannel === 'swarm' ? rawChannel : 'telegram'
    const user_id = b.user_id ?? chat_id
    if (!chat_id || !user_id || !text) return { status: 400, body: { error: 'bad payload' } }
    log.info('gbrain push', { chat_id, channel, text_len: text.length, attachments: b.attachments?.length ?? 0, from_agent: b.from_agent ?? b.agentId ?? null })
    const item: QueueItem = { chat_id, user_id, text, message_id: 0, channel }
    if (b.web_session_id) item.web_session_id = b.web_session_id
    queue.push(item)
    void drain()
    return { status: 200, body: { status: 'accepted' } }
  },
  onStop: async (body) => {
    const { assistant_message } = await handleStopHook(body as { transcript_path?: string })
    log.info('stop hook', { msg_len: assistant_message.length, chat: Array.from(lastInbound.keys()).pop() })
    const { text, reactions, buttons, files } = parseReply(assistant_message)
    const targetChat = Array.from(lastInbound.keys()).pop()
    const origin = targetChat !== undefined ? lastInbound.get(targetChat) : undefined
    const targetMsg = origin?.message_id
    const originChannel: QueueChannel = origin?.channel ?? 'telegram'
    disarmBusyTimer()
    stopPaneWatcher()
    stopMirror()
    stopTyping()
    if (targetChat !== undefined && (text.length > 0 || files.length > 0)) {
      await endTurnAndDelete()
      // Hybrid send-to-Telegram: always (originChannel='web' linked mode keeps
      // the operator's TG chat in the loop). DB-mirror happens below.
      if (text.length > 0) {
        if (buttons.length > 0) {
          await bot.sendButtons(targetChat, text, buttons)
        } else {
          const html = formatReplyHtml(text)
          const sent = await bot.sendHtml(targetChat, html)
          if (sent === null) await bot.sendText(targetChat, text)
        }
      }
      for (const f of files) {
        if (!existsSync(f.path)) {
          log.warn('FILE marker path missing', { path: f.path })
          continue
        }
        await bot.sendFile(targetChat, f)
      }
      if (originChannel === 'telegram') {
        if (reactions.length === 0 && targetMsg !== undefined) {
          await bot.setReaction(targetChat, targetMsg, 'thumbsup')
        } else {
          for (const r of reactions) {
            if (targetMsg !== undefined) await bot.setReaction(targetChat, targetMsg, r)
          }
        }
      }
      const outMeta: Record<string, unknown> = { chat_id: targetChat }
      if (origin?.web_session_id) outMeta.web_session_id = origin.web_session_id
      if (buttons.length > 0) outMeta.buttons = buttons
      if (files.length > 0) outMeta.files = files.map((f) => ({ path: f.path, kind: f.kind ?? null }))
      if (text.length > 0 || files.length > 0) {
        const dbText = text.length > 0 ? text : files.map((f) => `[file] ${f.path}`).join('\n')
        void dbInsertOut(originChannel, dbText, outMeta)
      }
    } else {
      await endTurn('done')
    }
    void dbSetIdle()
    fsm.onStop()
    void drain()
    return { status: 200, body: { ok: true } }
  },
  onPostTool: async (body) => {
    const b = body as { tool_name?: string; tool_input?: Record<string, unknown>; tool?: string; args?: Record<string, unknown> }
    const tool = b.tool_name ?? b.tool
    const args = b.tool_input ?? b.args ?? {}
    if (!tool) return { status: 200, body: { ok: true } }
    if (awaitingUserTool && tool === awaitingUserTool) {
      log.info('user answered, resuming heartbeat', { tool })
      awaitingUserTool = null
    }
    armBusyTimer()
    if (active) startPaneWatcher()
    if (!active || cfg.streaming.mode !== 'progress') return { status: 200, body: { ok: true } }
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
    if (AWAITING_USER_TOOLS.has(toolName)) {
      awaitingUserTool = toolName
      disarmBusyTimer()
      stopPaneWatcher()
      log.info('awaiting user input — heartbeat frozen', { tool: toolName })
      const surfaceChat = Array.from(lastInbound.keys()).pop()
        ?? cfg.features.owner_user_ids[0]
      if (surfaceChat !== undefined) {
        void (async () => {
          try {
            const html = renderAwaitingUserPrompt(toolName, toolArgs)
            if (html) {
              const msgId = await bot.sendHtml(surfaceChat, html)
              log.info('modal surfaced to telegram', { chat: surfaceChat, msg_id: msgId })
            } else {
              log.warn('renderAwaitingUserPrompt returned null', { tool: toolName })
            }
          } catch (err) {
            log.warn('failed to surface awaiting-user prompt', { error: String(err) })
          }
        })()
      } else {
        log.warn('no surface chat available — modal not delivered to telegram', { tool: toolName })
      }
    } else {
      if (awaitingUserTool) {
        log.info('user activity detected, resuming heartbeat', { prev: awaitingUserTool })
        awaitingUserTool = null
      }
      armBusyTimer()
      if (active) startPaneWatcher()
    }
    if (toolName === 'Task' && active && cfg.streaming.mode === 'progress') {
      active.tracker.onTaskStart(toolArgs)
      scheduleEdit(active)
    }
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
    callback_query?: {
      id?: string
      data?: string
      from: { id: number }
      message?: { chat: { id: number }; message_id: number }
    }
  }
  if (u.message) await onTelegramMessage(u.message)
  if (u.callback_query?.data) {
    const data = u.callback_query.data
    const fromId = u.callback_query.from.id
    const perm = data.match(/^perm:([0-9a-f-]+):(allow|deny)$/)
    if (perm && cfg.features.owner_user_ids.includes(fromId)) {
      const reqId = perm[1]
      const decision = perm[2] as 'allow' | 'deny'
      if (reqId) relay.callbackAnswer(reqId, decision)
    } else if (data.startsWith('abtn:')) {
      const payload = data.slice(5)
      const chatId = u.callback_query.message?.chat.id
      const msgId = u.callback_query.message?.message_id
      const gate = chatId !== undefined && allowMessage(
        { from_id: fromId, chat_id: chatId },
        { user_ids: cfg.telegram.allowed_user_ids, chat_ids: cfg.telegram.allowed_chat_ids },
      ) === 'allow'
      if (gate && chatId !== undefined && msgId !== undefined) {
        if (u.callback_query.id) {
          await bot.raw.api.answerCallbackQuery(u.callback_query.id, { text: payload }).catch(() => {})
        }
        await bot.clearButtons(chatId, msgId)
        queue.push({ chat_id: chatId, user_id: fromId, text: payload, message_id: msgId, channel: 'telegram' })
        void drain()
      }
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
