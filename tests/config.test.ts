import { describe, test, expect } from 'bun:test'
import { loadConfig } from '../src/config'

describe('config', () => {
  test('parses minimal env', () => {
    const env = {
      TELEGRAM_BOT_TOKEN: '123:abc',
      TELEGRAM_BOT_ID: '8615579381',
      TELEGRAM_ALLOWED_USER_IDS: '5660438838',
      TELEGRAM_ALLOWED_CHAT_IDS: '5660438838',
      BRIDGE_PORT: '9091',
      BRIDGE_BEARER_TOKEN: 'token',
      TMUX_SOCKET: 'tgbridge-skynet',
      TMUX_SESSION: 'skynet',
      CLAUDE_BINARY: '/home/x/.local/bin/claude',
      WORKSPACE: '/home/x/.claude-lab/skynet/.claude',
      STATE_DIR: '/home/x/.claude-lab/skynet/.claude/tg-bridge/state',
      LOG_DIR: '/home/x/.claude-lab/skynet/.claude/tg-bridge/logs',
    }
    const cfg = loadConfig(env)
    expect(cfg.telegram.bot_token).toBe('123:abc')
    expect(cfg.telegram.bot_id).toBe(8615579381)
    expect(cfg.telegram.allowed_user_ids).toEqual([5660438838])
    expect(cfg.bridge.port).toBe(9091)
    expect(cfg.features.business_api).toBe(false)
    expect(cfg.features.inject_sender_identity).toBe(false)
    expect(cfg.limits.permission_timeout_ms).toBe(50000)
    expect(cfg.limits.busy_timeout_ms).toBe(300000)
    expect(cfg.limits.queue_max_depth).toBe(100)
  })

  test('rejects missing TELEGRAM_BOT_TOKEN', () => {
    expect(() => loadConfig({})).toThrow(/TELEGRAM_BOT_TOKEN/)
  })

  test('strictBool: "false" string parses as false', () => {
    const env = {
      TELEGRAM_BOT_TOKEN: 't', TELEGRAM_BOT_ID: '1',
      TELEGRAM_ALLOWED_USER_IDS: '1', TELEGRAM_ALLOWED_CHAT_IDS: '1',
      BRIDGE_PORT: '9091', BRIDGE_BEARER_TOKEN: 't',
      TMUX_SOCKET: 's', TMUX_SESSION: 's',
      CLAUDE_BINARY: '/c', WORKSPACE: '/w', STATE_DIR: '/s', LOG_DIR: '/l',
      BUSINESS_API_ENABLED: 'false',
      INJECT_SENDER_IDENTITY: 'false',
    }
    const cfg = loadConfig(env)
    expect(cfg.features.business_api).toBe(false)
    expect(cfg.features.inject_sender_identity).toBe(false)
  })

  test('strictBool: "1" / "yes" / "on" parse as true', () => {
    const base = {
      TELEGRAM_BOT_TOKEN: 't', TELEGRAM_BOT_ID: '1',
      TELEGRAM_ALLOWED_USER_IDS: '1', TELEGRAM_ALLOWED_CHAT_IDS: '1',
      BRIDGE_PORT: '9091', BRIDGE_BEARER_TOKEN: 't',
      TMUX_SOCKET: 's', TMUX_SESSION: 's',
      CLAUDE_BINARY: '/c', WORKSPACE: '/w', STATE_DIR: '/s', LOG_DIR: '/l',
    }
    for (const v of ['1', 'yes', 'on', 'TRUE']) {
      expect(loadConfig({ ...base, BUSINESS_API_ENABLED: v }).features.business_api).toBe(true)
    }
    for (const v of ['0', 'no', 'off', '', 'random']) {
      expect(loadConfig({ ...base, BUSINESS_API_ENABLED: v }).features.business_api).toBe(false)
    }
  })

  test('parses alisher flags', () => {
    const env = {
      TELEGRAM_BOT_TOKEN: 'x',
      TELEGRAM_BOT_ID: '1',
      TELEGRAM_ALLOWED_USER_IDS: '1',
      TELEGRAM_ALLOWED_CHAT_IDS: '1',
      BRIDGE_PORT: '9101',
      BRIDGE_BEARER_TOKEN: 't',
      TMUX_SOCKET: 's',
      TMUX_SESSION: 's',
      CLAUDE_BINARY: '/c',
      WORKSPACE: '/w',
      STATE_DIR: '/s',
      LOG_DIR: '/l',
      BUSINESS_API_ENABLED: 'true',
      INJECT_SENDER_IDENTITY: 'true',
      OWNER_USER_IDS: '5660438838,8376223320',
    }
    const cfg = loadConfig(env)
    expect(cfg.features.business_api).toBe(true)
    expect(cfg.features.inject_sender_identity).toBe(true)
    expect(cfg.features.owner_user_ids).toEqual([5660438838, 8376223320])
  })
})
