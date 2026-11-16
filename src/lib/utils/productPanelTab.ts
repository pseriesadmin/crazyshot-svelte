/**
 * CMS 상품 상세 패널 — 초기 탭·마운트 판정 순수 함수 (2026-11-16)
 * 자식 재고 패널이 이전(대표) 상품 데이터로 먼저 마운트돼 탭이 '기본정보'에 고정되던 오류를 시험으로 고정하기 위해 분리했다.
 */

interface ResolveInitialTabInput<T extends string> {
  /** 선택 상품의 parent_product_id — 있으면 자식 재고 */
  parentProductId?: string | null
  initialTab: string | null | undefined
  tabsFilter?: readonly T[]
  isBundleProduct?: boolean | null
  validTabs: readonly T[]
}

/** 자식 재고는 항상 '이력', 그 외는 요청 탭이 유효할 때만(결합상품 탭은 결합상품만), 아니면 필터 첫 탭 또는 '기본정보' */
export function resolveInitialTab<T extends string>(input: ResolveInitialTabInput<T>): T | 'history' | 'basic' {
  if (input.parentProductId) return 'history'
  const tab = input.initialTab as T
  const valid =
    input.validTabs.includes(tab) &&
    (!input.tabsFilter || input.tabsFilter.includes(tab)) &&
    (input.initialTab !== 'bundles' || !!input.isBundleProduct)
  if (valid) return tab
  return input.tabsFilter?.[0] ?? 'basic'
}

/** 상세 데이터가 표시 대상(재고·대표) 자신의 것일 때만 패널을 마운트한다 — 조회 중 붙들린 이전 상품 데이터로는 열지 않는다 */
export function isPanelDataFor(detailProductId: string | null | undefined, targetId: string): boolean {
  return !!detailProductId && detailProductId === targetId
}
