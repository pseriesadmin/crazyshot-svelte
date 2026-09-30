import { describe, it, expect } from 'vitest'
import { summarizeTossPayment } from '$lib/utils/pgCancelStatus'

describe('summarizeTossPayment — PG 취소 실행 상태 요약', () => {
  it('CANCELED → 취소 완료, 취소금액·최종 취소시각 집계', () => {
    const r = summarizeTossPayment({
      status: 'CANCELED', totalAmount: 130000,
      cancels: [{ cancelAmount: 130000, canceledAt: '2026-09-30T10:00:00+09:00', cancelReason: '고객 자가취소', cancelStatus: 'DONE' }],
    })
    expect(r.state).toBe('cancelled')
    expect(r.label).toContain('취소 완료')
    expect(r.cancelledAmount).toBe(130000)
    expect(r.lastCancelledAt).toBe('2026-09-30T10:00:00+09:00')
  })
  it('PARTIAL_CANCELED → 부분 취소, 완료된 취소분만 합산', () => {
    const r = summarizeTossPayment({
      status: 'PARTIAL_CANCELED',
      cancels: [
        { cancelAmount: 20000, canceledAt: '2026-09-30T10:00:00+09:00', cancelStatus: 'DONE' },
        { cancelAmount: 5000, canceledAt: '2026-09-30T11:00:00+09:00', cancelStatus: 'IN_PROGRESS' },
      ],
    })
    expect(r.state).toBe('partial_cancelled')
    expect(r.cancelledAmount).toBe(20000)
    expect(r.lastCancelledAt).toBe('2026-09-30T11:00:00+09:00')
  })
  it('DONE → 취소 미실행(결제 유지)', () => {
    const r = summarizeTossPayment({ status: 'DONE', totalAmount: 1000, cancels: null })
    expect(r.state).toBe('not_cancelled')
    expect(r.cancelledAmount).toBe(0)
    expect(r.lastCancelledAt).toBeNull()
  })
  it('결제 미완료 상태들과 알 수 없는 상태', () => {
    expect(summarizeTossPayment({ status: 'READY' }).state).toBe('not_paid')
    expect(summarizeTossPayment({ status: 'EXPIRED' }).state).toBe('not_paid')
    expect(summarizeTossPayment({ status: 'IN_PROGRESS' }).state).toBe('in_progress')
    const u = summarizeTossPayment({})
    expect(u.state).toBe('unknown')
    expect(u.label).toContain('UNKNOWN')
  })
})
