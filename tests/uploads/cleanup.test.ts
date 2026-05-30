import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, writeFileSync, utimesSync, mkdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { cleanupUploads } from '../../src/uploads/cleanup'

describe('cleanupUploads', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tg-uploads-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  test('removes files older than TTL', () => {
    const now = Date.now()
    const old = join(dir, 'old.jpg')
    const fresh = join(dir, 'fresh.jpg')
    writeFileSync(old, 'x'.repeat(100))
    writeFileSync(fresh, 'y'.repeat(50))
    const oldMtime = (now - 40 * 24 * 60 * 60 * 1000) / 1000
    utimesSync(old, oldMtime, oldMtime)
    const r = cleanupUploads(dir, 30 * 24 * 60 * 60 * 1000, now)
    expect(r.removed).toBe(1)
    expect(r.kept).toBe(1)
    expect(r.freedBytes).toBe(100)
  })

  test('keeps directories', () => {
    mkdirSync(join(dir, 'sub'))
    const r = cleanupUploads(dir, 0, Date.now())
    expect(r.kept).toBe(1)
    expect(r.removed).toBe(0)
  })

  test('returns zeros when dir missing', () => {
    const r = cleanupUploads('/nonexistent/path', 1000)
    expect(r).toEqual({ removed: 0, kept: 0, freedBytes: 0 })
  })

  test('TTL=0 means no cleanup actually deletes (everything kept)', () => {
    const now = Date.now()
    writeFileSync(join(dir, 'a.jpg'), 'x')
    const r = cleanupUploads(dir, 0, now)
    expect(r.removed).toBe(0)
    expect(r.kept).toBe(1)
  })
})
