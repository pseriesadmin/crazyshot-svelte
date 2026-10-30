import { describe, it, expect } from 'vitest'
import { getCancelKind } from '$lib/utils/canCancelReservation'
import { resolveLeadRule } from '$lib/utils/pickupLeadTime'

/** 방문 수령 당일 예약(0일·18시 규칙)의 취소 — 수령일 시작 전까지 무료, 수령일부터는 불가(2026-10-30 Stephen 확정) */
const kst = (y: number, m: number, d: number, h: number, min = 0): number => Date.UTC(y, m - 1, d, h - 9, min)
const rule = resolveLeadRule({ isDeliveryType: false, deadlineText: '당일 예약은 오후 6시까지' })

describe('방문 수령(당일 규칙) 취소 판정', () => {
  const base = { status: 'confirmed', trackingNumber: null, startDate: '2026-11-05', rule }
  it('수령 전날 밤 23:59까지도 무료 취소(예전에는 전날 19시 이후 마감)', () => {
    expect(getCancelKind({ ...base, nowMs: kst(2026, 11, 4, 20, 0) })).toBe('free')
    expect(getCancelKind({ ...base, nowMs: kst(2026, 11, 4, 23, 59) })).toBe('free')
  })
  it('수령일이 시작되면(00:00) 수령 시작 후로 판정', () => {
    expect(getCancelKind({ ...base, nowMs: kst(2026, 11, 5, 0, 0) })).toBe('after_start')
    expect(getCancelKind({ ...base, nowMs: kst(2026, 11, 5, 10, 0) })).toBe('after_start')
  })
  it('기존 규칙(1일 전 19시)인 방식은 그대로 — 전날 19시 이후 마감', () => {
    const old = { ...base, rule: resolveLeadRule({ isDeliveryType: false, deadlineText: '예약 대여일 1일 전 오후 7시까지' }) }
    expect(getCancelKind({ ...old, nowMs: kst(2026, 11, 4, 18, 59) })).toBe('free')
    expect(getCancelKind({ ...old, nowMs: kst(2026, 11, 4, 19, 0) })).toBe('after_deadline')
  })
})
