import { describe, it, expect } from 'vitest'
import { dheroStageForReservation } from '$lib/server/dheroStageForReservation'
import { liveDheroBookings } from '$lib/utils/dheroLabels'

// [B1] account/rental/[id]/+page.server.ts 의 서버 계산 로직을 공유 헬퍼로 검증.
// 이전 버전: 이 파일 안에 computeDheroStageForId() 를 직접 구현(재현 로직).
// 현재 버전: dheroStageForReservation 을 직접 import해 테스트 — 실제 구현 변경이 테스트에 반영된다.

describe('[B1] dheroStageForReservation — tracking_number 검증', () => {
  it('tracking_number=null → isLive=false → dheroStage=null (B1 핵심 버그 재현)', () => {
    const result = dheroStageForReservation({
      id:                'r1',
      trackingNumber:    null,   // select 에 없으면 항상 null
      courierCode:       '두발히어로',
      dheroStatusCode:   2,     // 수거완료
      dheroMeta:         null,
      dheroReturnBookId: null,
      cardStatus:        'shipped',
    })
    expect(result).toBeNull()
  })

  it('tracking_number 있음 + 두발히어로 + 미취소 → dheroStage 반환 (B1 수정 후 정상 케이스)', () => {
    const result = dheroStageForReservation({
      id:                'r1',
      trackingNumber:    'TN-123',
      courierCode:       '두발히어로',
      dheroStatusCode:   2,     // 수거완료 → index 1
      dheroMeta:         null,
      dheroReturnBookId: null,
      cardStatus:        'shipped',
    })
    expect(result).not.toBeNull()
    expect(result?.index).toBe(1)
    expect(result?.label).toBe('수거완료')
    expect(result?.tone).toBe('normal')
  })

  it('tracking_number 있음 + dhero canceledAt → dheroStage=null (취소 접수는 liveIds 에서 제외)', () => {
    const result = dheroStageForReservation({
      id:                'r1',
      trackingNumber:    'TN-123',
      courierCode:       '두발히어로',
      dheroStatusCode:   0,
      dheroMeta:         { bookId: 'TN-123', canceledAt: '2026-10-01T00:00:00Z' },
      dheroReturnBookId: null,
      cardStatus:        'shipped',
    })
    expect(result).toBeNull()
  })

  it('tracking_number 있음 + 두발히어로 아님 → null (택배사 불일치)', () => {
    const result = dheroStageForReservation({
      id:                'r1',
      trackingNumber:    'TN-123',
      courierCode:       'CJ대한통운',
      dheroStatusCode:   2,
      dheroMeta:         null,
      dheroReturnBookId: null,
      cardStatus:        'shipped',
    })
    expect(result).toBeNull()
  })

  it('dheroStatusCode=null → null (상태 코드 미수신)', () => {
    const result = dheroStageForReservation({
      id:                'r1',
      trackingNumber:    'TN-123',
      courierCode:       '두발히어로',
      dheroStatusCode:   null,
      dheroMeta:         null,
      dheroReturnBookId: null,
      cardStatus:        'shipped',
    })
    expect(result).toBeNull()
  })

  // return_requested 추가 케이스 (MINOR-3 + 보완 2 핵심)
  it('return_requested + bookId 일치 → 반납 leg 신뢰', () => {
    const result = dheroStageForReservation({
      id:                'r1',
      trackingNumber:    'TN-123',
      courierCode:       '두발히어로',
      dheroStatusCode:   5,      // 배송완료
      dheroMeta:         { bookId: 'RTN-123' },
      dheroReturnBookId: 'RTN-123',
      cardStatus:        'return_requested',
    })
    expect(result).not.toBeNull()
    expect(result?.label).toBe('배송완료')
  })

  it('return_requested + bookId 불일치 → 접수 강제 반환 (MUTATION TEST 대상)', () => {
    // dheroStageForReservation 에서 returnBookId 스프레드를 제거하면 이 테스트가 실패한다:
    //   returnBookId=undefined → 검증 없음 → '배송완료' 반환 → expect('접수') FAIL
    const result = dheroStageForReservation({
      id:                'r1',
      trackingNumber:    'TN-123',
      courierCode:       '두발히어로',
      dheroStatusCode:   5,      // 배송완료
      dheroMeta:         { bookId: 'TN-123' },  // pickup leg bookId (불일치)
      dheroReturnBookId: 'RTN-123',
      cardStatus:        'return_requested',
    })
    expect(result).not.toBeNull()
    expect(result?.index).toBe(0)
    expect(result?.label).toBe('접수')
  })
})

describe('[B1] account/rental/+page.server.ts + account/+page.server.ts — liveDheroBookings 통합 검증', () => {
  it('liveDheroBookings: tracking_number 있는 미취소 두발히어로 접수만 반환', () => {
    const units = [
      { id: 'a', trackingNumber: 'T1', courierCode: '두발히어로',  dheroMeta: null },
      { id: 'b', trackingNumber: null,  courierCode: '두발히어로',  dheroMeta: null },
      { id: 'c', trackingNumber: 'T3', courierCode: '두발히어로',  dheroMeta: { canceledAt: '2026-10-01' } },
      { id: 'd', trackingNumber: 'T4', courierCode: 'CJ대한통운', dheroMeta: null },
    ]
    const live = liveDheroBookings(units)
    // 'a'(정상), 'd'(다른 택배사 — dhero 아닌 것도 통과)
    expect(live.map(u => u.id)).toEqual(['a', 'd'])
  })

  it('liveDheroBookings: tracking_number=null 이면 항상 제외', () => {
    const units = [
      { id: 'a', trackingNumber: null, courierCode: '두발히어로',  dheroMeta: null },
      { id: 'b', trackingNumber: null, courierCode: 'CJ대한통운', dheroMeta: null },
    ]
    expect(liveDheroBookings(units)).toHaveLength(0)
  })
})
