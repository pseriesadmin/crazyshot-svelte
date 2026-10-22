import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHmac } from 'node:crypto'

/**
 * 토스 웹훅 서명 검증 동작 보존 + 강화(보안 베이스라인 B-3, 2026-10-20)
 * 올바른 서명만 통과(200), 변조·누락·길이 불일치는 401 — 상수시간 비교로 바꿔도 결과는 동일해야 한다.
 */
const SECRET = 'test_secret_key'
vi.mock('$env/dynamic/private', () => ({ env: { TOSS_SECRET_KEY: 'test_secret_key', SUPABASE_SERVICE_ROLE_KEY: '' } }))
vi.mock('$lib/env/supabasePublic', () => ({ getSupabaseUrl: () => 'https://test.supabase.co' }))
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({}) }))

const sign = (body: string) => createHmac('sha256', SECRET).update(body).digest('base64')
async function post(body: string, signature: string | null) {
  const { POST } = await import('../../routes/api/webhooks/toss/+server')
  const headers = new Headers()
  if (signature !== null) headers.set('toss-payments-signature', signature)
  const request = new Request('https://crazyshot.kr/api/webhooks/toss', { method: 'POST', body, headers })
  return POST({ request } as unknown as Parameters<typeof POST>[0])
}

describe('POST /api/webhooks/toss 서명 검증', () => {
  beforeEach(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}) })
  const body = JSON.stringify({ eventType: 'PAYMENT_STATUS_CHANGED', data: { orderId: 'o1' } })

  it('올바른 서명 → 200', async () => {
    expect((await post(body, sign(body))).status).toBe(200)
  })
  it('본문이 변조되면 → 401', async () => {
    expect((await post(body + ' ', sign(body))).status).toBe(401)
  })
  it('같은 길이의 틀린 서명 → 401', async () => {
    const good = sign(body)
    const bad = (good[0] === 'A' ? 'B' : 'A') + good.slice(1)
    expect((await post(body, bad)).status).toBe(401)
  })
  it('길이가 다른 서명 → 401(예외 없이)', async () => {
    expect((await post(body, 'short')).status).toBe(401)
  })
  it('서명 헤더 없음 → 401', async () => {
    expect((await post(body, null)).status).toBe(401)
  })
})
