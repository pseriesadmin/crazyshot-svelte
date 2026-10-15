import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * QR·반출입 상태전이는 'confirmed'(계약완료)를 통과시키지 않는다 (2026-10-15, sp3 2차 검수 M-1)
 * — 서명·결제 없이 신청대기를 계약완료로 올리는 서버 경로 차단(service-operations.md §9).
 */
vi.mock('$lib/server/push', () => ({ sendReservationLifecyclePush: vi.fn(async () => undefined) }))
vi.mock('$lib/server/awardRentalCompletePoints', () => ({ awardRentalCompletePoints: vi.fn(async () => undefined) }))
vi.mock('$lib/server/awardOnTimeReturnPoints', () => ({ awardOnTimeReturnPoints: vi.fn(async () => undefined) }))

import { processRentalQrTransition, QR_ALLOWED_NEW_STATUSES } from '$lib/server/rentalQrTransition'

function admin() {
  const rpc = vi.fn(async () => ({ data: { ok: true }, error: null }))
  return { rpc, from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) } as never as { rpc: typeof rpc }
}

describe('processRentalQrTransition — 허용 상태 제한', () => {
  it("'confirmed'는 RPC를 부르지 않고 거절한다", async () => {
    const a = admin()
    const r = await processRentalQrTransition(a, { reservationId: 1, newStatus: 'confirmed', productId: '', userId: 'u' })
    expect(r.ok).toBe(false)
    expect(a.rpc).not.toHaveBeenCalled()
  })
  it.each(['cancelled', 'hold', 'expired', 'damage_claimed', 'bogus'])("'%s'도 거절한다", async (st) => {
    const a = admin()
    const r = await processRentalQrTransition(a, { reservationId: 1, newStatus: st, productId: '', userId: 'u' })
    expect(r.ok).toBe(false)
    expect(a.rpc).not.toHaveBeenCalled()
  })
  it.each(['shipped', 'in_use', 'return_requested', 'returned'])("'%s'는 상태전이 RPC를 호출한다", async (st) => {
    const a = admin()
    const r = await processRentalQrTransition(a, { reservationId: 1, newStatus: st, productId: '', userId: 'u' })
    expect(r.ok).toBe(true)
    expect(a.rpc).toHaveBeenCalledWith('update_reservation_status', { p_reservation_id: 1, p_new_status: st })
  })
  it('허용 집합에 confirmed가 없다', () => {
    expect(QR_ALLOWED_NEW_STATUSES.has('confirmed')).toBe(false)
  })
  it('호출부 2곳(API·모바일 QR 액션)이 공용 처리 함수를 거친다', () => {
    const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8')
    expect(read('src/routes/api/cms/rental-qr-transition/+server.ts')).toContain('processRentalQrTransition(')
    expect(read('src/routes/cms/mobile/qr/[product_id]/+page.server.ts')).toContain('processRentalQrTransition(')
  })
})
