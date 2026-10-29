// src/lib/server/dheroReturnLegDisplay.ts
// 반납 leg 배송상태 표시용 조회 헬퍼 — CMS GET /api/cms/reservations/[id]/dhero 응답용
//
// 책임: 표시용 조회만 (저장은 기존 크론·GET 라우트 내부 try 블록 담당)
// 인터페이스 분리 이유: 테스트 가능성(getDelivery 주입) + 8초 타임아웃 명시적 관리

import type { DheroDeliveryStatus } from '$lib/server/dhero'
import { getDeliveryByBookId } from '$lib/server/dhero'
import { isDheroBooking } from '$lib/server/dheroOrderUnits'

/** 반납 leg 조회가 메인 응답을 붙잡지 않게 하는 상한 (발송 leg 20초와 별개) */
export const DHERO_RETURN_DISPLAY_TIMEOUT_MS = 8000

/**
 * 반납 leg 배송상태를 패널 표시용으로 조회한다.
 *
 * - dheroReturnBookId 없거나 두발히어로가 아니면 null 반환 (조회 생략)
 * - 조회 실패 또는 타임아웃 시 fail-soft → null (메인 응답 차단 안 함)
 *
 * @param getDelivery 프로덕션은 기본값(getDeliveryByBookId), 테스트는 mock 주입
 * @param timeoutMs   기본값 DHERO_RETURN_DISPLAY_TIMEOUT_MS(8000)
 */
export async function fetchReturnLegForDisplay(
  dheroReturnBookId: string | null | undefined,
  courierCode:       string | null | undefined,
  getDelivery:       (bookId: string) => Promise<DheroDeliveryStatus> = getDeliveryByBookId,
  timeoutMs = DHERO_RETURN_DISPLAY_TIMEOUT_MS,
): Promise<DheroDeliveryStatus | null> {
  if (!dheroReturnBookId || !isDheroBooking(courierCode ?? null)) return null
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      getDelivery(dheroReturnBookId),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('dhero return display timeout')), timeoutMs)
      }),
    ])
  } catch {
    return null  // fail-soft — 반납 leg 조회 실패가 메인 응답을 막지 않음
  } finally {
    clearTimeout(timer)
  }
}
