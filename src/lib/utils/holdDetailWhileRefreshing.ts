/**
 * 상품목록 상세 패널이 재조회(저장 후 invalidateAll) 도중 닫혔다 열리지 않게 하는 선택 규칙.
 *
 * 재조회 동안 "열린 상품 id"와 서버 load의 선택 id가 잠깐 어긋나면 상세가 비어 패널이 unmount되고,
 * 다시 mount되면서 보던 탭이 초기화된다. 같은 상품이 계속 선택된 상태에서 "재조회가 아직 진행 중이라"
 * 상세가 일시적으로 비면 마지막으로 정상이었던 상세를 그대로 쓴다.
 *
 * 진행 중이 아닌데 비어 있는 경우(예: 열려 있던 상품이 삭제돼 서버가 상세를 돌려주지 않음)는 붙들지 않고
 * 그대로 비워 패널을 닫는다 — 삭제된 상품의 패널이 남는 것을 막는다.
 * 선택 해제(닫기)·다른 상품 선택·붙들 값이 없는 경우도 그대로 비운다.
 */

type DetailLike = {
  selectedProduct: { id: string } | null
  rootProduct: unknown | null
}

export function pickActiveDetail<T extends DetailLike>(args: {
  /** 현재 계산된 상세(서버 load 결과 또는 shallow-routing 조회 결과, 없으면 빈 상세) */
  computed: T
  /** 마지막으로 정상(대표·선택 상품이 모두 있는)이었던 상세 */
  held: T | null
  /** 지금 열려 있어야 하는 상품 id (닫힘이면 null) */
  activeSelectedId: string | null
  /** 상세 재조회가 아직 끝나지 않은 상태인가(열린 id와 서버 선택 id가 어긋나 있고 조회 결과가 아직 없음) */
  refreshing: boolean
}): T {
  const { computed, held, activeSelectedId, refreshing } = args
  if (computed.rootProduct) return computed
  if (
    refreshing &&
    activeSelectedId !== null &&
    held &&
    held.rootProduct &&
    held.selectedProduct?.id === activeSelectedId
  ) {
    return held
  }
  return computed
}
