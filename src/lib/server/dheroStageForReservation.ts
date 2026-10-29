// src/lib/server/dheroStageForReservation.ts
// 두발히어로 배송 5단계 계산 공유 헬퍼 — 3개 서버 파일에서 재사용
//
// 사용처:
//   1. src/routes/account/rental/[id]/+page.server.ts   (단건 상세)
//   2. src/routes/account/rental/+page.server.ts         (목록 — cardStatus=g.status, MINOR-3 수정)
//   3. src/routes/account/+page.server.ts                (홈 대여 카드)

import { liveDheroBookings } from '$lib/utils/dheroLabels'
import { dheroJourneyStage, type DheroStageInfo } from '$lib/utils/dheroJourneyStage'

export interface DheroStageInput {
  id:                string
  trackingNumber:    string | null
  courierCode:       string | null
  dheroStatusCode:   number | null
  dheroMeta:         { bookId?: unknown; canceledAt?: unknown; accidentAt?: unknown } | null
  dheroReturnBookId: string | null
  /** 카드(그룹 대표) 상태 — return_requested 시 반납 leg 검증에 사용. 행 단위 r.status 가 아닌 g.status 를 전달할 것 */
  cardStatus:        string
}

/**
 * 예약 하나에 대한 두발히어로 배송 5단계 정보를 계산한다.
 *
 * - liveDheroBookings 필터로 취소된 dhero 접수 제외
 * - cardStatus === 'return_requested' 시 returnBookId 검증 포함
 *   (dheroMeta.bookId !== returnBookId 이면 '접수'(index 0) 고정 — 발송 leg 데이터로 반납 단계를 오판하지 않게)
 */
export function dheroStageForReservation(input: DheroStageInput): DheroStageInfo | null {
  const liveIds = new Set(
    liveDheroBookings([{
      id:            input.id,
      trackingNumber: input.trackingNumber,
      courierCode:   input.courierCode,
      dheroMeta:     input.dheroMeta,
    }]).map(u => u.id),
  )
  if (!liveIds.has(input.id)) return null

  return dheroJourneyStage({
    courierCode:     input.courierCode,
    dheroStatusCode: input.dheroStatusCode,
    dheroMeta:       input.dheroMeta,
    ...(input.cardStatus === 'return_requested' ? { returnBookId: input.dheroReturnBookId } : {}),
  })
}
