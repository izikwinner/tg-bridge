export enum ClaudeState {
  IDLE = 'IDLE',
  BUSY = 'BUSY',
  WAITING_PERMISSION = 'WAITING_PERMISSION',
}

export interface Fsm {
  current(): ClaudeState
  onSent(): void
  onStop(): void
  onPreTool(): void
  onPermissionVerdict(): void
  forceIdle(): void
}

export function createFsm(): Fsm {
  let s: ClaudeState = ClaudeState.IDLE
  return {
    current: () => s,
    onSent: () => {
      if (s !== ClaudeState.IDLE) throw new Error(`onSent requires IDLE, got ${s}`)
      s = ClaudeState.BUSY
    },
    onStop: () => { s = ClaudeState.IDLE },
    onPreTool: () => {
      if (s !== ClaudeState.BUSY) throw new Error(`onPreTool requires BUSY, got ${s}`)
      s = ClaudeState.WAITING_PERMISSION
    },
    onPermissionVerdict: () => {
      if (s !== ClaudeState.WAITING_PERMISSION) throw new Error(`onPermissionVerdict requires WAITING_PERMISSION, got ${s}`)
      s = ClaudeState.BUSY
    },
    forceIdle: () => { s = ClaudeState.IDLE },
  }
}
