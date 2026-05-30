export interface QueueOpts { maxDepth: number }

export interface Queue<T> {
  push(item: T): T | undefined
  shift(): T | undefined
  size(): number
}

export function createQueue<T>(opts: QueueOpts): Queue<T> {
  const buf: T[] = []
  return {
    push(item) {
      let dropped: T | undefined
      if (buf.length >= opts.maxDepth) dropped = buf.shift()
      buf.push(item)
      return dropped
    },
    shift: () => buf.shift(),
    size: () => buf.length,
  }
}
