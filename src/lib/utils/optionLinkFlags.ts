// 옵션상품 설정(필수 선택·최소 1개 선택 필수·배송 대여 불가·무료 제공·수량 본상품 연동) 일괄 적용 (2026-10-26)
// 일괄 적용 행의 콤보 버튼을 누르면 모든 옵션 카드의 같은 설정을 즉시 같은 값으로 맞춘다.
// 원본 배열·객체는 바꾸지 않고 새 객체를 돌려준다(Svelte 반응성·CmsDragList bind:items 호환).
export function applyOptionFlag<T extends object, K extends keyof T>(options: T[], key: K, value: T[K]): T[] {
  return options.map((o) => ({ ...o, [key]: value }))
}
