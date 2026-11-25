// 'MD 추천' 바텀 팝업 노출조건 — product_page_md_picks 설정값의 popup 필드(관리자 설정 모달의 '노출조건')
//   on_wish    : 고객이 상품을 찜했을 때(썸네일 목록·상세 공통) 팝업을 열지 — 기본 ON(기존 동작 유지)
//   on_reserve : 고객이 상품 상세에서 '예약신청'을 눌렀을 때 팝업을 열지 — 기본 OFF(신규)
// 값이 없거나 형식이 달라도 기본값으로 정규화한다(DB 단 구조 검증 없음).

export type MdPopupTrigger = 'wish' | 'reserve'

export interface MdPopupCondition {
  on_wish: boolean
  on_reserve: boolean
}

export const DEFAULT_MD_POPUP_CONDITION: MdPopupCondition = { on_wish: true, on_reserve: false }

export function normalizeMdPopupCondition(raw: unknown): MdPopupCondition {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_MD_POPUP_CONDITION }
  const r = raw as Record<string, unknown>
  return {
    on_wish: typeof r.on_wish === 'boolean' ? r.on_wish : DEFAULT_MD_POPUP_CONDITION.on_wish,
    on_reserve: typeof r.on_reserve === 'boolean' ? r.on_reserve : DEFAULT_MD_POPUP_CONDITION.on_reserve,
  }
}

/**
 * 팝업을 열지 최종 판정. condition 이 null 이면 조건 조회가 실패한 것 —
 * 찜은 기존처럼 연다(실패 안내와 함께), 예약신청은 열지 않는다.
 */
export function resolveMdPopupOpen(condition: MdPopupCondition | null, trigger: MdPopupTrigger): boolean {
  if (condition === null) return trigger === 'wish'
  return isMdPopupAllowed(condition, trigger)
}

export function isMdPopupAllowed(condition: MdPopupCondition, trigger: MdPopupTrigger): boolean {
  return trigger === 'wish' ? condition.on_wish : condition.on_reserve
}
