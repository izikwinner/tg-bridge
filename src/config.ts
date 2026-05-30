import { z } from 'zod'

const csvNums = (s: string | undefined) =>
  (s ?? '').split(',').map(x => x.trim()).filter(Boolean).map(Number)

const strictBool = z
  .union([z.boolean(), z.string()])
  .default(false)
  .transform((v) => {
    if (typeof v === 'boolean') return v
    const s = v.trim().toLowerCase()
    return s === 'true' || s === '1' || s === 'yes' || s === 'on'
  })

const EnvSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_BOT_ID: z.coerce.number().int().positive(),
  TELEGRAM_ALLOWED_USER_IDS: z.string().min(1),
  TELEGRAM_ALLOWED_CHAT_IDS: z.string().min(1),
  BRIDGE_HOST: z.string().default('127.0.0.1'),
  BRIDGE_PORT: z.coerce.number().int().min(1).max(65535),
  BRIDGE_BEARER_TOKEN: z.string().min(1),
  TMUX_SOCKET: z.string().min(1),
  TMUX_SESSION: z.string().min(1),
  CLAUDE_BINARY: z.string().min(1),
  CLAUDE_FLAGS: z.string().default('--dangerously-skip-permissions'),
  WORKSPACE: z.string().min(1),
  STATE_DIR: z.string().min(1),
  LOG_DIR: z.string().min(1),
  BUSINESS_API_ENABLED: strictBool,
  INJECT_SENDER_IDENTITY: strictBool,
  OWNER_USER_IDS: z.string().optional(),
  PERMISSION_TIMEOUT_MS: z.coerce.number().int().positive().default(50000),
  PERMISSION_DEFAULT: z.enum(['allow', 'deny']).default('deny'),
  QUEUE_MAX_DEPTH: z.coerce.number().int().positive().default(100),
  BUSY_TIMEOUT_MS: z.coerce.number().int().positive().default(300000),
  STREAMING_MODE: z.enum(['off', 'partial', 'progress']).default('progress'),
  GROQ_API_KEY_FILE: z.string().optional(),
})

export interface AppConfig {
  telegram: {
    bot_token: string
    bot_id: number
    allowed_user_ids: number[]
    allowed_chat_ids: number[]
  }
  bridge: { host: string; port: number; bearer_token: string }
  claude: {
    binary: string
    flags: string
    workspace: string
    tmux_socket: string
    tmux_session: string
  }
  features: {
    business_api: boolean
    inject_sender_identity: boolean
    owner_user_ids: number[]
  }
  paths: { state_dir: string; log_dir: string }
  limits: {
    permission_timeout_ms: number
    permission_default: 'allow' | 'deny'
    queue_max_depth: number
    busy_timeout_ms: number
  }
  streaming: { mode: 'off' | 'partial' | 'progress' }
  voice: { groq_api_key_file: string | null }
}

export function loadConfig(env: Record<string, string | undefined>): AppConfig {
  const parsed = EnvSchema.parse(env)
  const ownerIds = parsed.OWNER_USER_IDS
    ? csvNums(parsed.OWNER_USER_IDS)
    : csvNums(parsed.TELEGRAM_ALLOWED_USER_IDS)
  return {
    telegram: {
      bot_token: parsed.TELEGRAM_BOT_TOKEN,
      bot_id: parsed.TELEGRAM_BOT_ID,
      allowed_user_ids: csvNums(parsed.TELEGRAM_ALLOWED_USER_IDS),
      allowed_chat_ids: csvNums(parsed.TELEGRAM_ALLOWED_CHAT_IDS),
    },
    bridge: {
      host: parsed.BRIDGE_HOST,
      port: parsed.BRIDGE_PORT,
      bearer_token: parsed.BRIDGE_BEARER_TOKEN,
    },
    claude: {
      binary: parsed.CLAUDE_BINARY,
      flags: parsed.CLAUDE_FLAGS,
      workspace: parsed.WORKSPACE,
      tmux_socket: parsed.TMUX_SOCKET,
      tmux_session: parsed.TMUX_SESSION,
    },
    features: {
      business_api: parsed.BUSINESS_API_ENABLED,
      inject_sender_identity: parsed.INJECT_SENDER_IDENTITY,
      owner_user_ids: ownerIds,
    },
    paths: { state_dir: parsed.STATE_DIR, log_dir: parsed.LOG_DIR },
    limits: {
      permission_timeout_ms: parsed.PERMISSION_TIMEOUT_MS,
      permission_default: parsed.PERMISSION_DEFAULT,
      queue_max_depth: parsed.QUEUE_MAX_DEPTH,
      busy_timeout_ms: parsed.BUSY_TIMEOUT_MS,
    },
    streaming: { mode: parsed.STREAMING_MODE },
    voice: { groq_api_key_file: parsed.GROQ_API_KEY_FILE ?? null },
  }
}
