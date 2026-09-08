/**
 * contractLineItems.ts — 계약서 반복행(repeat region) 항목 빌더
 *
 * Stage 1 | Harness Flow v3.2
 * 2026-08-28 수정(같은 날 후속) — Stephen 정정: "메인상품 수량은 항상 1"은 잘못된 확정.
 * 같은 상품(이름+품번 동일)을 여러 건 예약했으면(현재 DB구조상 실물 단위로 각각 별도
 * rental_reservations 행이 생성됨) 계약서에는 별도 행으로 중복 나열하지 않고 "같은 상품
 * 1줄 + 수량=실제 예약 건수"로 묶어서 보여줘야 한다(예: 같은 카메라 모델 2대 예약 →
 * "카메라, 수량 2" 한 줄). 반영 방식: 메인상품을 (이름+품번) 식별키로 그룹화해 건수를
 * 세고, 그 그룹에 속한 모든 reservation의 옵션상품은 그룹 뒤에 이어붙인다(옵션 자체의
 * 병합은 하지 않음 — 옵션은 이미 reservation_options.qty로 실제 수량을 갖고 있어 그대로
 * 유지, Stephen이 정정을 요청한 대상은 명시적으로 "메인상품"이었음).
 *
 * 목적: 한 주문(order)에 묶인 모든 reservation의 메인상품(동일상품 그룹화+건수 합산) +
 * 옵션상품(reservation_options)을 평탄화(flatten)한 ContractLineItem[] 배열을 생성한다.
 *
 * 행 구성 순서 (Q1=C안 확정 + 위 그룹화 반영):
 *   [메인상품그룹A(수량=A건수), A그룹에 속한 모든 옵션들, 메인상품그룹B(수량=B건수), ...]
 *   그룹 순서는 서로 다른 상품이 최초로 등장한 순서를 따른다.
 *
 * 금액 정책:
 *   - 메인상품 금액(2026-09-07 개정, Stephen 확정 — "그 상품의 실제 대여요금(price_rules)
 *     표시"): 그룹에 속한 각 reservation의 (product_id, duration_type) 조합에 해당하는
 *     price_rules.price를 합산해 원화 포맷 표시. 그룹 내 단 하나의 reservation이라도
 *     가격을 찾지 못하면(비활성·미설정 등) 그 reservation의 기여분은 0으로 계산되며,
 *     그룹 전체에서 단 하나도 가격을 못 찾았을 때만 기존처럼 '-'로 표시(과거 정책 Q5의
 *     "데이터 없음" 케이스는 그대로 유지).
 *   - 옵션상품 금액: unit_price × qty, 원화 포맷 (기존 그대로 유지)
 *
 * 수량 정책 (2026-08-28 정정 반영):
 *   - 메인상품: 그 상품(이름+품번)과 동일한 reservation 건수
 *   - 옵션상품: reservation_options.qty 실값(기존 그대로)
 */

import type { ContractLineItem } from '$lib/types/contract-module'

const COMPONENTS_TEXT_MAX = 50

// products.components(key-value JSONB, ProductDetailPanel.svelte "구성품" 탭 — products.md
// §4-1) → "key: value, key: value" 텍스트로 합친 뒤 50자(전체 문자 기준) 초과 시 말줄임.
// products/[id]/+page.svelte의 productComponents 파생(Object.entries + 빈 키 제외)과 동일한
// 필터링 규칙 재사용. 2026-09-08 — contract-data/+server.ts의 스칼라 {{구성품}} 전용
// 헬퍼였던 것을 이 파일로 이관 + export: "대여 장비내역" 반복영역의 {{비고}}에도 동일
// 로직으로 각 상품(메인·옵션)의 구성품 정보를 채우기 위함(로직 이원화 방지).
export function formatComponentsText(raw: unknown): string {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return '-'
  const entries = Object.entries(raw as Record<string, unknown>).filter(([k]) => k.trim())
  if (entries.length === 0) return '-'
  const joined = entries
    .map(([k, v]) => (typeof v === 'string' && v.trim() ? `${k}: ${v}` : k))
    .join(', ')
  return joined.length > COMPONENTS_TEXT_MAX
    ? joined.slice(0, COMPONENTS_TEXT_MAX) + '...'
    : joined
}

/**
 * 단일 reservation의 메인상품 정보.
 * contract-data API가 DB에서 조회한 후 buildLineItems에 전달하는 형태.
 */
export interface ReservationMainProduct {
  name: string
  product_code: string | null
  /**
   * 그 예약의 duration_type에 해당하는 price_rules 단가(대여요금, 2026-09-07 신설).
   * null이면 해당 조합의 활성 price_rules를 찾지 못한 경우 — 금액 칸은 '-'로 표시.
   */
  unit_price?: number | null
  /** products.components(구성품 JSONB, 2026-09-08 신설) — "대여 장비내역"의 {{비고}} 채움용 */
  components?: unknown
}

/**
 * 단일 reservation의 옵션상품 정보 (reservation_options 행 1개).
 */
export interface ReservationOption {
  option_name: string
  qty: number
  unit_price: number
  /** products.product_code — 부모 상품이면 정책상 null (products.md §2-1) */
  product_code: string | null
  /** 옵션상품의 products.components(구성품 JSONB, 2026-09-08 신설) */
  components?: unknown
}

/**
 * buildLineItems에 전달하는 reservation 단위 입력 구조.
 */
export interface ReservationForLineItems {
  mainProduct: ReservationMainProduct
  options: ReservationOption[]
}

/**
 * 원화 금액 포맷터 (한국어 숫자 형식 + '원' 접미사).
 */
function formatKrw(amount: number): string {
  return amount.toLocaleString('ko-KR') + '원'
}

/**
 * 주문에 묶인 reservation 목록으로부터 ContractLineItem 배열을 생성한다.
 *
 * @param reservations 한 주문의 reservation 목록 (빈 배열이면 빈 배열 반환)
 * @returns 평탄화된 ContractLineItem 배열
 *
 * @example
 * buildLineItems([
 *   { mainProduct: { name: '소니 FX3', product_code: 'CSLED001' }, options: [] },
 *   { mainProduct: { name: '캐논 R5', product_code: 'CSCAN001' },
 *     options: [{ option_name: '메모리카드', qty: 2, unit_price: 5000, product_code: null }] }
 * ])
 * // → [
 * //   { 상품명: '소니 FX3', 상품코드: 'CSLED001', 수량: '1', 금액: '-' },
 * //   { 상품명: '캐논 R5', 상품코드: 'CSCAN001', 수량: '1', 금액: '-' },
 * //   { 상품명: '메모리카드', 수량: '2', 금액: '10,000원' },
 * // ]
 */
export function buildLineItems(reservations: ReservationForLineItems[]): ContractLineItem[] {
  interface MainGroup {
    name: string
    product_code: string | null
    count: number
    amountSum: number
    hasAnyPrice: boolean
    options: ReservationOption[]
    /** 그룹의 첫 reservation에서 채움 — 같은 상품이므로 그룹 내 값이 동일 */
    components?: unknown
  }

  // 메인상품을 (이름+품번) 식별키로 그룹화 — 같은 상품의 reservation은 건수·금액을 누적하고
  // 그 reservation들의 옵션은 그룹에 순서대로 이어붙인다.
  const groups = new Map<string, MainGroup>()
  const groupOrder: string[] = []

  for (const r of reservations) {
    const key = `${r.mainProduct.name} ${r.mainProduct.product_code ?? ''}`
    let group = groups.get(key)
    if (!group) {
      group = { name: r.mainProduct.name, product_code: r.mainProduct.product_code, count: 0, amountSum: 0, hasAnyPrice: false, options: [], components: r.mainProduct.components }
      groups.set(key, group)
      groupOrder.push(key)
    }
    group.count += 1
    if (r.mainProduct.unit_price != null) {
      group.amountSum += r.mainProduct.unit_price
      group.hasAnyPrice = true
    }
    group.options.push(...r.options)
  }

  const items: ContractLineItem[] = []

  for (const key of groupOrder) {
    const group = groups.get(key)!

    const mainItem: ContractLineItem = {
      상품명: group.name,
      수량: String(group.count),
      금액: group.hasAnyPrice ? formatKrw(group.amountSum) : '-',
      비고: formatComponentsText(group.components),
    }
    if (group.product_code) {
      mainItem.상품코드 = group.product_code
    }
    items.push(mainItem)

    // 옵션상품 행 (reservation_options 순서 유지 — 옵션 자체는 병합하지 않음)
    for (const opt of group.options) {
      const optItem: ContractLineItem = {
        상품명: opt.option_name,
        수량: String(opt.qty),
        금액: formatKrw(opt.unit_price * opt.qty),
        비고: formatComponentsText(opt.components),
      }
      if (opt.product_code) {
        optItem.상품코드 = opt.product_code
      }
      items.push(optItem)
    }
  }

  return items
}
