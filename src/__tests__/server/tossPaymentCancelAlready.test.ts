import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('$env/dynamic/private', () => ({ env: { TOSS_SECRET_KEY: 'test_gsk_x' } }))
import { tossPaymentCancel } from '$lib/server/tossPaymentCancel'

describe('tossPaymentCancel — 이미 취소된 결제', () => {
  const realFetch = globalThis.fetch
  beforeEach(() => {
    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url)
      if (init?.method === 'POST') return new Response(JSON.stringify({ code: 'ALREADY_CANCELED_PAYMENT', message: '이미 취소된 결제 입니다.' }), { status: 400 })
      return new Response(JSON.stringify({ cancels: [{ canceledAt: '2026-09-01T00:00:00+09:00' }] }), { status: 200 })
    }) as unknown as typeof fetch
  })
  afterEach(() => { globalThis.fetch = realFetch })

  it('ALREADY_CANCELED_PAYMENT는 성공으로 보고 취소 시각을 돌려준다', async () => {
    const r = await tossPaymentCancel('k', '관리자 예약 취소')
    expect(r).toMatchObject({ ok: true, alreadyCanceled: true, pgCancelledAt: '2026-09-01T00:00:00+09:00' })
  })
})
