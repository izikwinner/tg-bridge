import { describe, test, expect } from 'bun:test'
import { createRelay } from '../../src/permission/relay'

describe('relay', () => {
  test('resolves to allow on operator answer', async () => {
    const sent: { chatId: number; text: string; reqId: string }[] = []
    const relay = createRelay({
      sendPrompt: async (chatId, text, reqId) => { sent.push({ chatId, text, reqId }) },
      ownerChatId: 5660438838,
      timeoutMs: 1000,
      defaultDecision: 'deny',
    })
    const verdictP = relay.requestVerdict({ tool: 'Bash', args: { command: 'sudo x' } })
    await new Promise(r => setTimeout(r, 10))
    expect(sent.length).toBe(1)
    relay.callbackAnswer(sent[0]!.reqId, 'allow')
    expect(await verdictP).toBe('allow')
  })

  test('defaults to deny on timeout', async () => {
    const relay = createRelay({
      sendPrompt: async () => {},
      ownerChatId: 5660438838,
      timeoutMs: 50,
      defaultDecision: 'deny',
    })
    const v = await relay.requestVerdict({ tool: 'Bash', args: { command: 'x' } })
    expect(v).toBe('deny')
  })

  test('ignores callback for unknown request_id', async () => {
    const relay = createRelay({
      sendPrompt: async () => {},
      ownerChatId: 5660438838,
      timeoutMs: 100,
      defaultDecision: 'deny',
    })
    expect(() => relay.callbackAnswer('does-not-exist', 'allow')).not.toThrow()
  })
})
