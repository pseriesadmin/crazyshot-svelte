// src/lib/utils/dheroLabels.ts
// 두발히어로 상태 코드 → 사람이 읽을 수 있는 텍스트 (단일 정의 — 서버·클라이언트 공유)
//
// 정본: PDF "두발히어로 배송 api 안내" status 코드 목록 (MEDIUM-2 수정 — 기존 중복·오표기 통합)
//
// 수정 이력:
//   2026-08-25: RentalDetailPanel.svelte의 클라이언트 측 중복 정의(잘못된 매핑값 포함)를
//   제거하고 서버(dhero.ts)의 PDF 스펙 일치 버전을 이 파일로 통합. dhero.ts는 이 파일에서
//   re-export, RentalDetailPanel.svelte는 이 파일에서 직접 import.

export const DHERO_STATUS_LABEL: Record<number, string> = {
  0:  '배송접수',
  1:  '수거배차',
  2:  '수거완료',
  3:  '입고완료',
  4:  '출고완료',
  5:  '배송완료',
  6:  '반송완료',
  7:  '분실완료',
  8:  '배송대기',
  12: '배송연기',
}

/**
 * 두발히어로 쪽에서 취소된 접수인지 — 조회 응답(또는 저장된 dhero_meta)의 canceledAt 으로만 판단한다.
 * 취소돼도 status 코드는 그대로(0 등)라 코드로는 구분되지 않는다(2026-10-27 dev 실험).
 */
export function isDheroCanceled(meta: { canceledAt?: unknown } | null | undefined): boolean {
  const at = meta?.canceledAt
  return typeof at === 'string' && at.trim() !== ''
}

/** 상태 표시 라벨 — 취소된 접수는 코드 라벨('배송접수' 등) 대신 '취소' */
export function dheroStatusLabel(info: { status: number; canceledAt?: unknown }): string {
  return isDheroCanceled(info) ? '취소' : (DHERO_STATUS_LABEL[info.status] ?? String(info.status))
}

interface DheroBookingUnit { trackingNumber: string | null; courierCode: string | null; dheroMeta: Record<string, unknown> | null }

/**
 * 같은 주문의 예약 중 "살아 있는" 운송장을 가진 것만 — 출고 처리·수동 접수의 재접수 방지 판정용.
 * 접수 1건은 형제 예약이 같은 접수번호를 공유하고 취소는 접수 단위 사실이므로, 같은 접수번호를 가진 예약 중
 * 하나라도 '두발히어로 접수 + dhero_meta.canceledAt'이면 그 접수번호 전체를 취소로 본다
 * (조회·동기화가 열린 예약 한 건씩만 meta 를 갱신해 형제 meta 가 늦게 따라오는 경우 대응).
 * 다른 택배사 운송장(courier_code≠'두발히어로')은 canceledAt 과 무관하게 항상 살아 있는 것으로 본다.
 */
export function liveDheroBookings<T extends DheroBookingUnit>(units: readonly T[]): T[] {
  const canceledNumbers = new Set<string>()
  for (const u of units) {
    if (u.trackingNumber != null && u.courierCode === '두발히어로' && isDheroCanceled(u.dheroMeta)) canceledNumbers.add(u.trackingNumber)
  }
  return units.filter((u) => u.trackingNumber != null && !(u.courierCode === '두발히어로' && canceledNumbers.has(u.trackingNumber)))
}
