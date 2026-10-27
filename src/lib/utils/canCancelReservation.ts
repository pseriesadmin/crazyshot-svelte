/**
 * 고객 셀프 "예약신청취소" 가능 여부 판정 (순수 함수, KST 기준)
 *
 * 정책(2026-09-30, Stephen 제안·구현 범위 ①③):
 *   hold(신청대기)            → 'free'          언제든 취소 가능(결제·계약 전이라 환불 없음)
 *   confirmed(계약완료·운송장 미등록)
 *     ① 수령 신청 마감 전      → 'free'          즉시 취소·전액 환불 (마감 = 수령일 N일 전 H시, pickupLeadTime.ts와 동일 규칙)
 *     ② 마감 후 ~ 대여 시작 전 → 'after_deadline' 즉시 취소 불가 → 고객센터 문의 (취소 요청·수수료는 정책 확정 후 별도 구현)
 *     ③ 대여 시작일(KST) 이후  → 'after_start'    취소 불가 → 고객센터 문의(노쇼·조기반납 처리)
 *   그 외(shipped 이후, 운송장 등록) → 'unavailable'
 *
 * 배송형 방식(isDeliveryType, 2026-10-26 Stephen 확정):
 *   confirmed → 수령(배송)일 당일 09:00 KST 전 'free'([취소신청]) / 이후 'inquiry'([취소문의] — 문의 카드로 담당자에게 전달)
 *   shipped   → 'inquiry' / 그 외(in_use 이후) → 'unavailable'. 운송장 등록 여부는 판정에 쓰지 않는다.
 *
 * 같은 주문에 묶인 형제 예약은 주문 전체가 함께 취소·환불되므로 worstCancelKind로 가장 엄격한 결과를 따른다.
 */
import { DEFAULT_LEAD_RULE, kstDateIso, pickupCutoffMs, type LeadRule } from './pickupLeadTime'

export type CancelKind = 'free' | 'after_deadline' | 'inquiry' | 'after_start' | 'unavailable'

const SEVERITY: Record<CancelKind, number> = { free: 0, after_deadline: 1, inquiry: 2, after_start: 3, unavailable: 4 }

/**
 * 배송형 취소 컷오프 — 수령(배송)일 당일 09:00 KST. 장바구니 달력의 신청 마감 규칙(pickupLeadTime)과 별개라
 * 취소 정책만 따로 바꿀 수 있도록 그 모듈의 규칙을 재사용하지 않고 취소 전용 상수로 둔다.
 */
export const DELIVERY_CANCEL_RULE: LeadRule = { leadDays: 0, cutoffHour: 9 }

export function getCancelKind({
  status,
  trackingNumber,
  startDate,
  rule = DEFAULT_LEAD_RULE,
  nowMs = Date.now(),
  isDeliveryType = false,
}: {
  status: string
  trackingNumber: string | null | undefined
  startDate: string | null | undefined
  /** 수령 방식의 신청 마감 규칙(resolveLeadRule 결과) */
  rule?: LeadRule
  /** 테스트에서 주입 가능한 현재 시각 (기본: Date.now()) */
  nowMs?: number
  /** 배송형 수령 방식(rental_method_options.is_delivery_type) — 09:00 컷오프 + 취소문의 정책 적용 */
  isDeliveryType?: boolean
}): CancelKind {
  if (status === 'hold') return 'free'
  if (isDeliveryType && (status === 'confirmed' || status === 'shipped')) {
    if (status === 'shipped') return 'inquiry'
    if (!startDate) return 'free'
    return nowMs < pickupCutoffMs(startDate.slice(0, 10), DELIVERY_CANCEL_RULE) ? 'free' : 'inquiry'
  }
  if (status !== 'confirmed' || trackingNumber) return 'unavailable'

  // 수령일 정보가 없으면 판정 불가 — 정보 없이 차단하는 것은 부당하므로 허용(기존 정책 유지)
  if (!startDate) return 'free'
  const start = startDate.slice(0, 10)

  if (kstDateIso(nowMs) >= start) return 'after_start'
  return nowMs < pickupCutoffMs(start, rule) ? 'free' : 'after_deadline'
}

/** 여러 예약(같은 주문의 형제 포함) 중 가장 엄격한 판정 */
export function worstCancelKind(kinds: CancelKind[]): CancelKind {
  return kinds.reduce<CancelKind>((worst, k) => (SEVERITY[k] > SEVERITY[worst] ? k : worst), 'free')
}

export function canCancelReservation(args: Parameters<typeof getCancelKind>[0]): boolean {
  return getCancelKind(args) === 'free'
}
