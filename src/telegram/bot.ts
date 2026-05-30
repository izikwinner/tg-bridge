import { Bot } from 'grammy'
import type { ReactionTypeEmoji } from '@grammyjs/types'
import { chunkForTelegram } from '../reply/sender.js'
import type { Logger } from '../log.js'

export interface BotWrapper {
  raw: Bot
  sendText(chatId: number, text: string, replyToMessageId?: number): Promise<void>
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
