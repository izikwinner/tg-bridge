import { describe, test, expect } from 'bun:test'
import { ClaudeState, createFsm } from '../../src/claude/state'

describe('FSM', () => {
  test('starts IDLE', () => {
    const fsm = createFsm()
    expect(fsm.current()).toBe(ClaudeState.IDLE)
  })

  test('IDLE → BUSY on sent', () => {
    const fsm = createFsm()
    fsm.onSent()
    expect(fsm.current()).toBe(ClaudeState.BUSY)
  })

  test('BUSY → IDLE on stop', () => {
    const fsm = createFsm()
    fsm.onSent()
    fsm.onStop()
    expect(fsm.current()).toBe(ClaudeState.IDLE)
  })

  test('BUSY → WAITING_PERMISSION on pretool', () => {
    const fsm = createFsm()
    fsm.onSent()
    fsm.onPreTool()
    expect(fsm.current()).toBe(ClaudeState.WAITING_PERMISSION)
  })

  test('WAITING_PERMISSION → BUSY on verdict', () => {
    const fsm = createFsm()
    fsm.onSent()
    fsm.onPreTool()
    fsm.onPermissionVerdict()
    expect(fsm.current()).toBe(ClaudeState.BUSY)
  })

  test('onSent throws when not IDLE', () => {
    const fsm = createFsm()
    fsm.onSent()
    expect(() => fsm.onSent()).toThrow(/IDLE/)
  })

  test('onStop is no-op when already IDLE', () => {
    const fsm = createFsm()
    expect(() => fsm.onStop()).not.toThrow()
    expect(fsm.current()).toBe(ClaudeState.IDLE)
  })
})
