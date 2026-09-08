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
  /**
   * 비고(2026-09-08 신규 반영) — 그 상품의 products.components(구성품)를
   * contractLineItems.ts formatComponentsText()로 포맷한 값. 구성품이 없으면 '-'.
   */
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
  // ── 신규: 수령/반납 날짜 (2026-09-06, HTML형 원본 엑셀 "대여 및 반납시간" 표 대조로 발견) ──
  /**
   * rental_reservations.start_date/end_date(DATE) — "YYYY.MM.DD" 형식으로 포맷.
   * 기존 {{수령일시}}/{{반납일시}}는 이름과 달리 pickup_time/return_time(TEXT, 시간만)이
   * 소스라 날짜 정보가 없다 — 원본 엑셀은 대여/반납 칸에 날짜 행(YYYY.MM.DD)과 시간 행
   * (HH:MM)을 별도 행으로 나눠 표시하는데, 이 날짜 행을 재현할 변수가 그동안 없었다.
   */
  수령일자?: string
  반납일자?: string
  // ── 신규: CMS 전역 정밀검증 v6 CRITICAL #5(CS2654) C2 — 대응데이터 없던 6개 항목 (2026-09-07) ──
  /** contracts.created_at(이 예약의 최신 계약 발행 시각) — "YYYY.MM.DD" 형식 */
  계약서발행일?: string
  /**
   * rental_reservations.pickup_point_id → pickup_points.name 우선, 없으면
   * return_point_id → pickup_points.name. 둘 다 없으면 '-'. (Stephen 확정: "새로 연결
   * 필요" — 어느 지점(수령/반납)을 우선할지는 명시 지정이 없어 수령 지점을 1순위로 함)
   */
  지점옵션?: string
  /** 기본대여요금과 완전히 동일한 값(Stephen 확인) — 할인 반영 전 정상가 alias */
  '총 정상 대여가'?: string
  /** 수령일시~반납일시 실제 시간차(총 시간). 배송형 수령/반납(is_delivery_type)이면
   *  pickup_time/return_time이 실제 고객 선택 시각이 아니므로(§상단 주석) '-' 처리 */
  총사용시간?: string
  /** 할인차감과 완전히 동일한 값(Stephen 확인) — alias */
  할인반영금액?: string
  // 이용기간금액: Stephen 확정(2026-09-07) — "나중에 사용할 수도 있는 항목으로 남겨놓아도
  // 문제 없을 경우 '추후 재사용 예정' 주석 기록" — 현재 미구현, 코드 추가 없음(의도적 보류).
  // 기본대여요금과 개념이 겹칠 가능성이 있어 별도 계산 없이 보류 상태 유지.

  // ── 신규: "구분" 섹션 수령/반납 방법+지점 통합 표기 (2026-09-08) ──────────────
  /**
   * "방식명 (지점명)" 형태 — 지점이 없는 방식(배송 등)은 방식명만. `지점옵션`(수령 지점
   * 우선, 없으면 반납 지점 — 방향 구분 없는 단일값)과 달리 이 필드는 pickup_point_id만
   * 사용해 수령 leg 전용으로 계산한다. `수령형태`(방식명 단독)는 그대로 유지 — 다른
   * 참조처(ContractFieldPanel 칩 등) 하위호환을 위해 값을 덮어쓰지 않고 신규 필드로 추가.
   */
  수령방법지점?: string
  /** 반납 leg 전용 — return_point_id만 사용. 계산 방식은 `수령방법지점`과 동일(대칭). */
  반납방법지점?: string
  // ── 신규: 실제 대여일수 (2026-09-08, RentalDetailPanel과 동일 산식 재사용) ─────
  /**
   * "1일"·"12시간"·"1일 12시간" 형태 — cartRentalFee.ts의 calcRentalMinutes()+
   * calcRentalPeriodParts()로 계산(RentalDetailPanel.svelte·rentalDaysLabel.ts의
   * attachRentalDaysLabel()과 완전히 동일한 산식, 새 계산식을 만들지 않고 재사용).
   * 배송형(is_delivery_type) 방식이어도 "1day 강제청구" 산식으로 실제 값이 나온다는 점이
   * `총사용시간`(배송 시 '-')과 다르다 — 의도된 차이(원시 경과시간 vs 청구 기준 일수).
   */
  대여일수?: string
}
