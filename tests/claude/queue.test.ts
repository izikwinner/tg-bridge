import { describe, test, expect } from 'bun:test'
import { createQueue } from '../../src/claude/queue'

describe('queue', () => {
  test('FIFO order', () => {
    const q = createQueue<string>({ maxDepth: 10 })
    q.push('a'); q.push('b'); q.push('c')
    expect(q.shift()).toBe('a')
    expect(q.shift()).toBe('b')
    expect(q.shift()).toBe('c')
    expect(q.shift()).toBeUndefined()
  })

  test('drops oldest when over maxDepth', () => {
    const q = createQueue<number>({ maxDepth: 3 })
    q.push(1); q.push(2); q.push(3); q.push(4)
    expect(q.size()).toBe(3)
    expect(q.shift()).toBe(2)
  })

  test('returns dropped item from push', () => {
    const q = createQueue<number>({ maxDepth: 2 })
    expect(q.push(1)).toBeUndefined()
    expect(q.push(2)).toBeUndefined()
    expect(q.push(3)).toBe(1)
  })
})
