import { describe, test, expect } from 'bun:test'
import { allowMessage } from '../../src/telegram/gate'

describe('allowMessage', () => {
  const allowed = { user_ids: [5660438838], chat_ids: [5660438838] }

  test('allows when user + chat in allowlist', () => {
    expect(allowMessage({ from_id: 5660438838, chat_id: 5660438838 }, allowed)).toBe('allow')
  })

  test('denies when user not in list', () => {
    expect(allowMessage({ from_id: 999, chat_id: 5660438838 }, allowed)).toBe('user_not_allowed')
  })

  test('denies when chat not in list', () => {
    expect(allowMessage({ from_id: 5660438838, chat_id: 12345 }, allowed)).toBe('chat_not_allowed')
  })
})
