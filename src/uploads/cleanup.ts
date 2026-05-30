import { readdirSync, statSync, unlinkSync } from 'fs'
import { join } from 'path'

export interface CleanupResult {
  removed: number
  kept: number
  freedBytes: number
}

export function cleanupUploads(dir: string, maxAgeMs: number, now: number = Date.now()): CleanupResult {
  let removed = 0
  let kept = 0
  let freedBytes = 0
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return { removed: 0, kept: 0, freedBytes: 0 }
  }
  for (const name of entries) {
    const path = join(dir, name)
    try {
      const st = statSync(path)
      if (!st.isFile()) {
        kept += 1
        continue
      }
      if (maxAgeMs > 0 && now - st.mtimeMs > maxAgeMs) {
        unlinkSync(path)
        removed += 1
        freedBytes += st.size
      } else {
        kept += 1
      }
    } catch {
      // skip
    }
  }
  return { removed, kept, freedBytes }
}
