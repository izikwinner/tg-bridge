import { Bot } from 'grammy'
import type { ReactionTypeEmoji } from '@grammyjs/types'
import { chunkForTelegram } from '../reply/sender.js'
import type { Logger } from '../log.js'

export interface BotButton {
  label: string
  payload: string
}

const POSITIVE_RE = /^(ha|yes|da|ok|tasdiq|aha|albatta|sure|yep|qabul)$/i
const NEGATIVE_RE = /^(yo'?q|yoq|no|net|нет|bekor|cancel|reject|rad)$/i

function decorateLabel(label: string): string {
  const s = label.trim()
  if (/^\p{Emoji}/u.test(s)) return s
  if (POSITIVE_RE.test(s)) return `✅ ${s}`
  if (NEGATIVE_RE.test(s)) return `❌ ${s}`
  return s
}

export interface BotWrapper {
  raw: Bot
  sendText(chatId: number, text: string, replyToMessageId?: number): Promise<void>
  sendButtons(chatId: number, text: string, buttons: BotButton[]): Promise<void>
  sendHtml(chatId: number, html: string): Promise<number | null>
  editHtml(chatId: number, messageId: number, html: string): Promise<void>
  deleteMessage(chatId: number, messageId: number): Promise<void>
  setReaction(chatId: number, messageId: number, emoji: string): Promise<void>
  getMe(): Promise<{ id: number; username: string }>
  start(onUpdate: (update: unknown) => Promise<void>): Promise<void>
  stop(): Promise<void>
}

const EMOJI_MAP: Record<string, string> = {
  thumbsup: '👍', thumbsdown: '👎', heart: '❤', fire: '🔥',
  eyes: '👀', hundred: '💯', clap: '👏', pray: '🙏',
  ok: '👌', check: '✅', cross: '❌', warning: '⚠️',
}

export function createBot(token: string, log: Logger): BotWrapper {
  const bot = new Bot(token)

  return {
    raw: bot,
    async sendText(chatId, text, replyToMessageId) {
      for (const chunk of chunkForTelegram(text)) {
        await bot.api.sendMessage(
          chatId,
          chunk,
          replyToMessageId
            ? { reply_parameters: { message_id: replyToMessageId } }
            : {},
        ).catch(err => log.warn('sendMessage failed', { error: String(err) }))
      }
    },
    async sendButtons(chatId, text, buttons) {
      if (buttons.length === 0) return
      const rows = buttons.map((b) => [{ text: decorateLabel(b.label), callback_data: `abtn:${b.payload}` }])
      try {
        await bot.api.sendMessage(chatId, text, {
          reply_markup: { inline_keyboard: rows },
        })
      } catch (err) {
        log.warn('sendButtons failed', { error: String(err) })
      }
    },
    async sendHtml(chatId, html) {
      try {
        const m = await bot.api.sendMessage(chatId, html, { parse_mode: 'HTML' })
        return m.message_id
      } catch (err) {
        log.warn('sendHtml failed', { error: String(err) })
        return null
      }
    },
    async editHtml(chatId, messageId, html) {
      try {
        await bot.api.editMessageText(chatId, messageId, html, { parse_mode: 'HTML' })
      } catch (err) {
        const msg = String(err)
        if (!msg.includes('message is not modified')) {
          log.warn('editHtml failed', { error: msg })
        }
      }
    },
    async deleteMessage(chatId, messageId) {
      try {
        await bot.api.deleteMessage(chatId, messageId)
      } catch (err) {
        log.warn('deleteMessage failed', { error: String(err) })
      }
    },
    async setReaction(chatId, messageId, emojiSlug) {
      const emoji = EMOJI_MAP[emojiSlug]
      if (!emoji) {
        log.warn('unknown reaction slug', { slug: emojiSlug })
        return
      }
      await bot.api.setMessageReaction(
        chatId,
        messageId,
        [{ type: 'emoji', emoji: emoji as ReactionTypeEmoji['emoji'] }],
      ).catch(err => log.warn('setReaction failed', { error: String(err) }))
    },
    async getMe() {
      const me = await bot.api.getMe()
      return { id: me.id, username: me.username }
    },
    async start(onUpdate) {
      bot.use(async (ctx) => { await onUpdate(ctx.update) })
      void bot.start({ allowed_updates: ['message', 'callback_query', 'business_message', 'business_connection'] })
    },
    async stop() {
      await bot.stop()
    },
  }
}
