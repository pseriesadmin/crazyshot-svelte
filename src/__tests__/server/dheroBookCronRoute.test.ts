import { describe, it, expect, vi, beforeEach } from 'vitest'

/** /api/cron/dhero-book 인증·응답 — 실제 처리는 dheroAutoBook.test.ts */
const envMock = vi.hoisted(() => ({ CRON_SECRET: 'sec', SUPABASE_SERVICE_ROLE_KEY: 'key' }) as Record<string, string | undefined>)
vi.mock('$env/dynamic/private', () => ({ env: envMock }))
vi.mock('$lib/env/supabasePublic', () => ({ getSupabaseUrl: () => 'https://t.supabase.co' }))
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({}) }))
const mockRun = vi.fn()
vi.mock('$lib/server/dheroAutoBook', () => ({ runDheroAutoBook: (...a: unknown[]) => mockRun(...a) }))

import { GET } from '../../routes/api/cron/dhero-book/+server'

const call = (auth?: string) => GET({ request: new Request('http://x/api/cron/dhero-book', { headers: auth ? { authorization: auth } : {} }) } as never)

beforeEach(() => {
  mockRun.mockReset()
  envMock.CRON_SECRET = 'sec'
  envMock.SUPABASE_SERVICE_ROLE_KEY = 'key'
})

describe('GET /api/cron/dhero-book', () => {
  it('CRON_SECRET 미설정이면 401(fail-closed)', async () => {
    envMock.CRON_SECRET = undefined
    expect((await call('Bearer sec')).status).toBe(401)
    expect(mockRun).not.toHaveBeenCalled()
  })
  it('헤더가 없거나 틀리면 401', async () => {
    expect((await call()).status).toBe(401)
    expect((await call('Bearer wrong')).status).toBe(401)
    expect(mockRun).not.toHaveBeenCalled()
  })
  it('서비스 키가 없으면 500', async () => {
    envMock.SUPABASE_SERVICE_ROLE_KEY = undefined
    expect((await call('Bearer sec')).status).toBe(500)
  })
  it('정상 호출은 처리 결과 건수를 돌려준다', async () => {
    mockRun.mockResolvedValue({ todayKst: '2026-11-18', booked: [1, 2], failed: [{ reservationId: 3, message: 'x' }] })
    const res = await call('Bearer sec')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, date: '2026-11-18', booked: 2, failed: 1 })
  })
  it('조회 오류는 500', async () => {
    mockRun.mockResolvedValue({ todayKst: '2026-11-18', booked: [], failed: [], error: 'x' })
    expect((await call('Bearer sec')).status).toBe(500)
  })
})
