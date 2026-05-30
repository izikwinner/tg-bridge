import { describe, test, expect } from 'bun:test'
import { injectSenderPrefix } from '../../src/persona/sender-prefix'

describe('injectSenderPrefix', () => {
  test('owner identified', () => {
    const out = injectSenderPrefix({
      text: 'hello',
      user_id: 100000001,
      username: 'operator',
      first_name: 'Operator',
      owner_ids: [100000001, 100000002],
    })
    expect(out).toBe('[sender: id=100000001 @operator name=Operator | role=owner]\nhello')
  })

  test('client (non-owner) identified', () => {
    const out = injectSenderPrefix({
      text: 'нужна помощь',
      user_id: 1234567,
      username: 'client_user',
      first_name: 'Алишер',
      owner_ids: [100000001],
    })
    expect(out).toBe('[sender: id=1234567 @client_user name=Алишер | role=client]\nнужна помощь')
  })

  test('handles missing username and name', () => {
    const out = injectSenderPrefix({
      text: 'x',
      user_id: 99,
      username: undefined,
      first_name: undefined,
      owner_ids: [99],
    })
    expect(out).toBe('[sender: id=99 | role=owner]\nx')
  })
})
