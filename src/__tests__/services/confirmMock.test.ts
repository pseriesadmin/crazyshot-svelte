import { describe, it, expect, vi } from 'vitest'

/**
 * confirm-mock 비활성화 (2026-10-03, CRITICAL — Stephen 승인)
 *
 * 대상: src/routes/api/checkout/confirm-mock/+server.ts
 *
 * 배경: 이 경로는 PG 미연동 시절의 임시 자동 승인 API로, 로그인한 고객이 본인 hold 예약번호로 호출하면
 *       서버 금액 검증 없이 결제완료로 기록하고 body의 couponIds·pointsUsed를 그대로 소진하는 구멍이 있었다.
 *       어떤 화면도 호출하지 않으며(실결제는 contracts/[token]/pay-mock·pay-result,
 *       checkout/pay/[orderId]/result), 이제 모든 요청을 410으로 거부한다.
 *       (이전의 BL-CHAT-C4 범위 한정 테스트는 이 경로가 더 이상 동작하지 않으므로 대체됨)
 *
 * 기대: 세션·본문과 무관하게 항상 410, DB 클라이언트 생성·조회 없음.
 */

const createClientMock = vi.fn()
vi.mock('@supabase/supabase-js', () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}))

const { POST } = await import('../../routes/api/checkout/confirm-mock/+server')

function call(body: unknown, session: boolean): Promise<Response> {
  const request = new Request('http://localhost/api/checkout/confirm-mock', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const locals = { safeGetSession: async () => ({ session: session ? { user: { id: 'u1' } } : null }) }
  return POST({ locals, request } as unknown as Parameters<typeof POST>[0]) as Promise<Response>
}

describe('POST /api/checkout/confirm-mock — 비활성화', () => {
  it('로그인 고객이 reservationIds·couponIds·pointsUsed를 보내도 410, DB 접근 없음', async () => {
    const res = await call({ reservationIds: [1, 2], couponIds: ['c1'], pointsUsed: 5000 }, true)
    expect(res.status).toBe(410)
    const body = (await res.json()) as { success: boolean; code?: string }
    expect(body.success).toBe(false)
    expect(body.code).toBe('GONE')
    expect(createClientMock).not.toHaveBeenCalled()
  })

  it('세션이 없어도 동일하게 410(인증 분기 이전에 차단)', async () => {
    const res = await call({}, false)
    expect(res.status).toBe(410)
    expect(createClientMock).not.toHaveBeenCalled()
  })
})
