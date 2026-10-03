import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireAndLog } from '../../lib/utils/fireAndLog'

/**
 * fireAndLog — 실패해도 본 흐름을 막지 않고 경고 로그만 남긴다 (2026-10-03)
 * 완료기준: 성공은 조용히, HTTP 4xx/5xx와 네트워크 오류는 console.warn, 어떤 경우도 throw·unhandled rejection 없음
 */
describe('fireAndLog', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  beforeEach(() => warn.mockClear())
  afterEach(() => vi.unstubAllGlobals())

  const flush = () => new Promise((r) => setTimeout(r, 0))

  it('POST JSON으로 요청하고 성공하면 경고하지 않는다', async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    vi.stubGlobal('fetch', f)
    fireAndLog('notify-hold', '/api/x', { a: 1 })
    await flush()
    expect(f).toHaveBeenCalledWith('/api/x', expect.objectContaining({ method: 'POST', body: JSON.stringify({ a: 1 }) }))
    expect(warn).not.toHaveBeenCalled()
  })

  it('HTTP 오류(res.ok=false)는 경고 로그를 남긴다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))
    fireAndLog('notify-hold', '/api/x', {})
    await flush()
    expect(warn).toHaveBeenCalledWith('[notify-hold] HTTP 500')
  })

  it('네트워크 오류도 경고 로그만 남기고 throw하지 않는다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    fireAndLog('notify-hold', '/api/x', {})
    await flush()
    expect(warn).toHaveBeenCalled()
  })
})
