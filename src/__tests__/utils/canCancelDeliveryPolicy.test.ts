import { describe, it, expect } from 'vitest'
import { getCancelKind, worstCancelKind, DELIVERY_CANCEL_RULE } from '$lib/utils/canCancelReservation'

/**
 * 배송형 취소 정책 (2026-10-26 Stephen 확정): 배송 당일 09:00(KST) 전 [취소신청](free), 이후 [취소문의](inquiry).
 * 운송장 등록 여부는 판정에 쓰지 않는다. 비배송형(방문·퀵·무인함 등)은 기존 규칙 그대로.
 */
// KST 시각 → epoch ms (실행 환경 타임존과 무관)
const kst = (y: number, m: number, d: number, h: number, min = 0): number => Date.UTC(y, m - 1, d, h - 9, min)

describe('배송형 취소 판정', () => {
  const base = { status: 'confirmed', trackingNumber: null as string | null, startDate: '2026-10-29', isDeliveryType: true }

  it('DC-1 컷오프 상수는 수령일 당일 09시', () => {
    expect(DELIVERY_CANCEL_RULE).toEqual({ leadDays: 0, cutoffHour: 9 })
  })
  it('DC-2 배송 당일 08:59 → free, 09:00 → inquiry', () => {
    expect(getCancelKind({ ...base, nowMs: kst(2026, 10, 29, 8, 59) })).toBe('free')
    expect(getCancelKind({ ...base, nowMs: kst(2026, 10, 29, 9, 0) })).toBe('inquiry')
  })
  it('DC-3 배송 전날·며칠 전 → free (기존 2일 전 19시 마감은 적용하지 않는다)', () => {
    expect(getCancelKind({ ...base, nowMs: kst(2026, 10, 28, 20, 0) })).toBe('free')
    expect(getCancelKind({ ...base, nowMs: kst(2026, 10, 26, 12, 0) })).toBe('free')
  })
  it('DC-4 운송장이 등록돼도 판정은 같다 (09시 전 free, 이후 inquiry)', () => {
    expect(getCancelKind({ ...base, trackingNumber: 'TEST-1', nowMs: kst(2026, 10, 28, 12, 0) })).toBe('free')
    expect(getCancelKind({ ...base, trackingNumber: 'TEST-1', nowMs: kst(2026, 10, 29, 15, 0) })).toBe('inquiry')
  })
  it('DC-5 수령일이 이미 지난 계약완료 → inquiry', () => {
    expect(getCancelKind({ ...base, nowMs: kst(2026, 10, 30, 10, 0) })).toBe('inquiry')
  })
  it('DC-6 수령일 정보가 없으면 free (기존 정책 유지)', () => {
    expect(getCancelKind({ ...base, startDate: null, nowMs: kst(2026, 10, 29, 12, 0) })).toBe('free')
  })
  it('DC-7 반출중(shipped)은 inquiry, 대여중 이후는 unavailable', () => {
    expect(getCancelKind({ ...base, status: 'shipped', trackingNumber: 'T', nowMs: kst(2026, 10, 29, 12, 0) })).toBe('inquiry')
    expect(getCancelKind({ ...base, status: 'in_use', nowMs: kst(2026, 10, 29, 12, 0) })).toBe('unavailable')
    expect(getCancelKind({ ...base, status: 'return_requested', nowMs: kst(2026, 10, 29, 12, 0) })).toBe('unavailable')
  })
  it('DC-8 신청대기(hold)는 배송형도 언제든 free', () => {
    expect(getCancelKind({ ...base, status: 'hold', nowMs: kst(2026, 10, 30, 12, 0) })).toBe('free')
  })
})

describe('비배송형은 기존 규칙 불변', () => {
  const VISIT = { leadDays: 1, cutoffHour: 19 }
  const base = { status: 'confirmed', trackingNumber: null as string | null, startDate: '2026-10-02', rule: VISIT, isDeliveryType: false }
  it('DC-9 방문: 마감 전 free / 마감 후 after_deadline / 시작일 after_start', () => {
    expect(getCancelKind({ ...base, nowMs: kst(2026, 10, 1, 18, 59) })).toBe('free')
    expect(getCancelKind({ ...base, nowMs: kst(2026, 10, 1, 19, 0) })).toBe('after_deadline')
    expect(getCancelKind({ ...base, nowMs: kst(2026, 10, 2, 0, 0) })).toBe('after_start')
  })
  it('DC-10 비배송형 운송장 등록은 기존처럼 unavailable, isDeliveryType 생략도 기존 동작', () => {
    expect(getCancelKind({ ...base, trackingNumber: 'T', nowMs: kst(2026, 10, 1, 12, 0) })).toBe('unavailable')
    const { isDeliveryType: _omit, ...noFlag } = base
    void _omit
    expect(getCancelKind({ ...noFlag, nowMs: kst(2026, 10, 1, 18, 59) })).toBe('free')
  })
})

describe('worstCancelKind 순서', () => {
  it('DC-11 free < after_deadline < inquiry < after_start < unavailable', () => {
    expect(worstCancelKind(['free', 'inquiry'])).toBe('inquiry')
    expect(worstCancelKind(['inquiry', 'after_deadline'])).toBe('inquiry')
    expect(worstCancelKind(['inquiry', 'after_start'])).toBe('after_start')
    expect(worstCancelKind(['free', 'free'])).toBe('free')
  })
})
