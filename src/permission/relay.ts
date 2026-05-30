import type { ToolInvocation } from './policy.js'

export interface RelayOpts {
  sendPrompt: (chatId: number, text: string, reqId: string) => Promise<void>
  ownerChatId: number
  timeoutMs: number
  defaultDecision: 'allow' | 'deny'
}

type Decision = 'allow' | 'deny'

export interface Relay {
  requestVerdict(inv: ToolInvocation): Promise<Decision>
  callbackAnswer(reqId: string, decision: Decision): void
}

export function createRelay(opts: RelayOpts): Relay {
  const pending = new Map<string, { resolve: (d: Decision) => void; timer: Timer }>()

  return {
    requestVerdict(inv) {
      const reqId = crypto.randomUUID()
      return new Promise<Decision>(resolve => {
        const timer = setTimeout(() => {
          pending.delete(reqId)
          resolve(opts.defaultDecision)
        }, opts.timeoutMs)
        pending.set(reqId, { resolve, timer })
        const cmd = typeof inv.args['command'] === 'string' ? (inv.args['command'] as string) : '<no command>'
        const prompt = `Agent wants to run:\n${inv.tool}: ${cmd}\n\nAllow or Deny?`
        void opts.sendPrompt(opts.ownerChatId, prompt, reqId).catch(() => {})
      })
    },
    callbackAnswer(reqId, decision) {
      const p = pending.get(reqId)
      if (!p) return
      clearTimeout(p.timer)
      pending.delete(reqId)
      p.resolve(decision)
    },
  }
}
