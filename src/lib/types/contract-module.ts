import type { ContentBlock } from '$lib/types/content-editor'

export interface ContractModule {
  id: string
  label: string
  category: 'customer' | 'reservation'
  blocks: ContentBlock[]
}

/**
 * 반복 영역(repeat region) 전용 항목별 데이터.
 * 한 주문(order)에 묶인 reservation 전체를 평탄화(flatten)한 배열의 원소.
 * 순서: [메인상품A, 옵션A1, 옵션A2, ..., 메인상품B, 옵션B1, ...]
 *
 * - 메인상품 행: 수량='1', 금액='-' (per-reservation 분리 금액 없음)
 * - 옵션상품 행: 수량=reservation_options.qty, 금액=unit_price×qty 원화 포맷
 */
export interface ContractLineItem {
  /** 상품명 또는 옵션명 */
  상품명: string
  /** 품번 — null이면 필드 자체 없음(부모 상품 등 품번 없는 경우) */
  상품코드?: string
  /** 수량 문자열 (메인='1', 옵션=실제 qty) */
  수량: string
  /** 금액 포맷 문자열 (메인='-', 옵션=unit_price×qty+'원') */
  금액: string
  /** 비고 — 현재 비어있음, 향후 확장용 */
  비고?: string
}

export interface ContractSubstitutionData {
  // ── 기존 16개 스칼라 필드 (하위호환 — 절대 제거·타입변경 금지) ─────────────
  고객이름?: string
  연락처?: string
  이메일?: string
  주소?: string
  예약코드?: string
  상품코드?: string
  상품명?: string
  수량?: string
  수령형태?: string
  수령일시?: string
  반납형태?: string
  반납일시?: string
  기본대여요금?: string
  할인금액?: string
  배송비?: string
  부가세?: string
  최종합계?: string
  // ── 신규: 요금 유형(대여 기간 구분) 라벨 (2026-08-31) ───────────────────────
  /** duration_type('12h'|'24h'|'1day'|'monthly')을 사람이 읽을 수 있는 라벨로 변환 */
  요금유형?: string
  // ── 신규: 결제 확정 시점 쿠폰·포인트 차감 내역 (2026-08-31) ─────────────────
  /**
   * 쿠폰으로 차감된 금액 — payment_transactions.coupon_discount(결제 확정 시점 기록).
   * ⚠️ 기존 `할인금액`(orders.discount_amount)과는 소스가 다르다 — orders.discount_amount는
   * 주문 생성 시점(create_reservation_order)에 회원등급(POP/CRAZY) 할인율만으로 계산되며
   * 쿠폰·포인트는 전혀 반영하지 않는다(과거 문서에 "쿠폰+포인트 통합"으로 잘못 기재돼
   * 있었음 — 실제 RPC 코드 대조로 정정, contract.md 참고).
   */
  할인차감?: string
  /** 포인트로 차감된 금액 — payment_transactions.point_amount(결제 확정 시점 기록) */
  차감포인트?: string
  // ── 신규: 구성품 목록 (2026-09-03) ──────────────────────────────────────────
  /**
   * products.components(key-value JSONB)를 "key: value, key: value" 텍스트로 합친 값.
   * 50자(한영숫자 포함 전체 문자 기준) 초과 시 말줄임(...) 적용 — Stephen 확정.
   */
  구성품?: string
  // ── 신규: 반복 영역 전용 항목 배열 ────────────────────────────────────────
  /**
   * 주문에 묶인 모든 reservation의 메인상품 + 옵션상품을 평탄화한 배열.
   * Stage 1에서 contract-data API가 채워 반환함.
   * 반복 영역이 없는 기존 템플릿은 이 필드를 사용하지 않으므로 기존 동작에 영향 없음.
   */
  상품목록?: ContractLineItem[]
}
