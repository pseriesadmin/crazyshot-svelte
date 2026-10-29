import { describe, it, expect } from 'vitest'
import { dheroStageForReservation } from '$lib/server/dheroStageForReservation'

// 공통 베이스 입력 — shipped 상태, 두발히어로, 배송완료(5)
const BASE = {
  id:                'r1',
  trackingNumber:    'TN-001',
  courierCode:       '두발히어로',
  dheroStatusCode:   5,         // 배송완료 → index 4 label '배송완료'
  dheroMeta:         { bookId: 'TN-001' },
  dheroReturnBookId: 'RTN-001',
}

describe('dheroStageForReservation — cardStatus 기준 반납 leg 검증', () => {

  // ─────────────────── 기본 live 체크 ───────────────────

  it('tracking_number=null → isLive=false → null', () => {
    expect(dheroStageForReservation({ ...BASE, trackingNumber: null, cardStatus: 'shipped' })).toBeNull()
  })

  it('canceledAt → isLive=false → null', () => {
    expect(dheroStageForReservation({
      ...BASE,
      dheroMeta: { bookId: 'TN-001', canceledAt: '2026-10-01T00:00:00Z' },
      cardStatus: 'shipped',
    })).toBeNull()
  })

  it('두발히어로 아님 → null', () => {
    expect(dheroStageForReservation({ ...BASE, courierCode: 'CJ대한통운', cardStatus: 'shipped' })).toBeNull()
  })

  // ─────────────────── shipped (반납 leg 체크 없음) ───────────────────

  it('status=shipped → returnBookId 조건부 스프레드 없음 → pickup leg 신뢰', () => {
    const result = dheroStageForReservation({ ...BASE, cardStatus: 'shipped' })
    expect(result).not.toBeNull()
    expect(result?.label).toBe('배송완료')
    expect(result?.index).toBe(4)
  })

  // ─────────────────── return_requested ───────────────────

  it('status=return_requested + dheroMeta.bookId === dheroReturnBookId → 반납 leg 신뢰', () => {
    // dhero_meta.bookId 가 반납번호와 일치 → 올바른 반납 leg
    const result = dheroStageForReservation({
      ...BASE,
      dheroMeta:         { bookId: 'RTN-001' },  // return leg에서 저장된 bookId
      dheroReturnBookId: 'RTN-001',
      cardStatus: 'return_requested',
    })
    expect(result).not.toBeNull()
    expect(result?.label).toBe('배송완료')
  })

  it('status=return_requested + dheroMeta.bookId !== dheroReturnBookId → 접수 강제 반환', () => {
    // dhero_meta.bookId = 발송 leg 번호 (반납 leg 상태 아직 미저장)
    // MUTATION TEST 대상: dheroStageForReservation 의 returnBookId 스프레드를 제거하면
    //   returnBookId=undefined → 검증 없음 → '배송완료' 반환 → 이 expect(label).toBe('접수') 실패
    const result = dheroStageForReservation({
      ...BASE,
      dheroMeta:         { bookId: 'TN-001' },   // pickup leg bookId (불일치)
      dheroReturnBookId: 'RTN-001',
      cardStatus: 'return_requested',
    })
    expect(result).not.toBeNull()
    expect(result?.index).toBe(0)
    expect(result?.label).toBe('접수')
  })

  it('status=return_requested + dheroReturnBookId=null → null (반납 접수 미등록)', () => {
    expect(dheroStageForReservation({
      ...BASE,
      dheroReturnBookId: null,
      cardStatus: 'return_requested',
    })).toBeNull()
  })

  it('status=return_requested + dheroMeta 일치 + canceledAt → 취소 레이블 반환', () => {
    const result = dheroStageForReservation({
      ...BASE,
      dheroMeta:         { bookId: 'RTN-001', canceledAt: '2026-10-20T10:00:00Z' },
      dheroReturnBookId: 'RTN-001',
      cardStatus: 'return_requested',
    })
    // canceledAt 이 있어도 tracking_number 가 있고 dheroMeta.canceledAt 은 취소된 접수 → isLive=false
    expect(result).toBeNull()
  })

  it('status=return_requested + dheroStatusCode=null → null (상태 코드 미수신)', () => {
    expect(dheroStageForReservation({
      ...BASE,
      dheroMeta:         { bookId: 'RTN-001' },
      dheroStatusCode:   null,
      dheroReturnBookId: 'RTN-001',
      cardStatus: 'return_requested',
    })).toBeNull()
  })
})
