import { describe, it, expect } from 'vitest'
import { isContractPaymentPending, readReservationPayState, readSigningRef } from '../../lib/utils/contractPayable'

describe('isContractPaymentPending — 서명 후 결제 대기 판정', () => {
  it('hold + 결제 시각 없음 → 결제 대기', () => {
    expect(isContractPaymentPending('hold', null)).toBe(true)
    expect(isContractPaymentPending('hold', undefined)).toBe(true)
  })
  it('hold 이지만 결제 시각이 채워져 있으면 결제 대기가 아니다', () => {
    expect(isContractPaymentPending('hold', '2026-11-22T01:00:00Z')).toBe(false)
  })
  it.each(['expired', 'cancelled', 'confirmed', 'shipped', 'in_use', 'completed', 'pending', null, undefined])(
    '%s 는 결제 대기가 아니다(만료·취소·확정 이후 포함)',
    (s) => { expect(isContractPaymentPending(s as string | null | undefined, null)).toBe(false) },
  )
})

describe('DB 조회 결과 읽기 — 형태가 달라도 던지지 않고 안전한 기본값', () => {
  it('readSigningRef: 정상 행', () => {
    expect(readSigningRef({ token: 't', signed_at: '2026-11-22T00:00:00Z', contracts: { reservation_id: 461 } }))
      .toEqual({ token: 't', signedAt: '2026-11-22T00:00:00Z', reservationId: 461 })
  })
  it('readSigningRef: null·배열·잘못된 타입이면 전부 null', () => {
    const empty = { token: null, signedAt: null, reservationId: null }
    expect(readSigningRef(null)).toEqual(empty)
    expect(readSigningRef([])).toEqual(empty)
    expect(readSigningRef({ token: 5, signed_at: {}, contracts: 'x' })).toEqual(empty)
  })
  it('readReservationPayState: 정상·누락', () => {
    expect(readReservationPayState({ status: 'hold', payment_confirmed_at: null })).toEqual({ status: 'hold', paymentConfirmedAt: null })
    expect(readReservationPayState(undefined)).toEqual({ status: null, paymentConfirmedAt: null })
  })
})
